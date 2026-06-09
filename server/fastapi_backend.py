from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import os
import re
import fitz  # PyMuPDF
from google import genai
from dotenv import load_dotenv
import pymongo
from bson import ObjectId
import bcrypt
from datetime import datetime, timezone

# Load environment variables dynamically using absolute path
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
env_path = os.path.join(root_dir, ".env")
load_dotenv(dotenv_path=env_path)

# Check Gemini API Key
api_key = os.getenv("GEMINI_API_KEY")
client = None
if api_key:
    try:
        # Initialize Gemini Client
        client = genai.Client(api_key=api_key)
    except Exception as e:
        print(f"Gemini client initialization failed: {e}")

# Initialize MongoDB Connection
mongo_uri = os.getenv("MONGO_URI")
if not mongo_uri:
    raise ValueError("MONGO_URI is missing from environment variables (.env)")

try:
    mongo_client = pymongo.MongoClient(mongo_uri)
    # Check connection
    mongo_client.admin.command('ping')
    
    # Resolve database name
    try:
        db = mongo_client.get_default_database()
    except Exception:
        # Check if paper_summarizer exists in list, otherwise test
        if 'paper_summarizer' in mongo_client.list_database_names():
            db = mongo_client['paper_summarizer']
        else:
            db = mongo_client['test']
    print(f"Connected to MongoDB database: {db.name}")
except Exception as e:
    print(f"MongoDB connection failed: {e}")
    # We exit if database connection fails, just like the Node backend
    import sys
    sys.exit(1)

app = FastAPI()

# Configure CORS using CLIENT_ORIGIN
client_origin = os.getenv("CLIENT_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[client_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class SignupRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

# ----------------- Local Heuristic Summarizer -----------------
JUNK_SENTENCE_PATTERNS = [
    re.compile(r'\b(?:copyright|all rights reserved|permission|license|terms of use)\b', re.IGNORECASE),
    re.compile(r'\b(?:phone|mobile|tel|fax|email|e-mail|address|corresponding author)\b', re.IGNORECASE),
    re.compile(r'\b(?:www\.|https?:|@)\b', re.IGNORECASE),
    re.compile(r'\b(?:figure|fig\.|image|photo|diagram|chart|graph|table)\b', re.IGNORECASE),
    re.compile(r'\b(?:references|bibliography|acknowledg(?:e)?ments)\b', re.IGNORECASE),
    re.compile(r'^\s*\d+\s*$'),
    re.compile(r'^[^a-zA-Z]*$')
]

RESEARCH_KEYWORDS = [
    'abstract', 'objective', 'purpose', 'problem', 'method', 'approach',
    'model', 'framework', 'dataset', 'experiment', 'evaluation', 'result',
    'finding', 'accuracy', 'performance', 'analysis', 'contribution',
    'proposed', 'demonstrate', 'conclude', 'limitation', 'future work'
]

def count_words(text: str) -> int:
    return len(text.strip().split())

def trim_to_words(text: str, max_words: int) -> str:
    words = text.strip().split()
    return " ".join(words[:max_words])

def remove_unwanted_text(text: str) -> str:
    # Remove URLs
    text = re.sub(r'https?://\S+|www\.\S+', ' ', text, flags=re.IGNORECASE)
    # Remove emails
    text = re.sub(r'\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b', ' ', text, flags=re.IGNORECASE)
    # Remove phone numbers
    text = re.sub(r'\+?\d[\d\s().-]{7,}\d', ' ', text)
    # Remove DOIs / ISBNs
    text = re.sub(r'\b(?:doi|isbn|issn)\s*[:/]\s*\S+', ' ', text, flags=re.IGNORECASE)
    # Remove figure captions
    text = re.sub(r'\b(?:fig(?:ure)?|image|photo|diagram|chart|graph|table)\s*\.?\s*\d+[a-z]?[^.!?]*[.!?]?', ' ', text, flags=re.IGNORECASE)
    # Remove page numbers
    text = re.sub(r'\b(?:page|vol(?:ume)?|issue|no)\s+\d+\b', ' ', text, flags=re.IGNORECASE)
    # Clean whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def is_useful_research_sentence(sentence: str) -> bool:
    words = count_words(sentence)
    lower = sentence.lower()
    
    if words < 8 or words > 55:
        return False
        
    if any(pattern.search(sentence) for pattern in JUNK_SENTENCE_PATTERNS):
        return False
        
    digit_count = sum(c.isdigit() for c in sentence)
    if digit_count > len(sentence) * 0.25:
        return False
        
    has_letters = bool(re.search(r'[a-z]{3,}', sentence, re.IGNORECASE))
    has_keyword = any(kw in lower for kw in RESEARCH_KEYWORDS)
    return has_letters and has_keyword

def score_research_sentence(sentence: str, index: int) -> int:
    lower = sentence.lower()
    keyword_score = sum(3 for kw in RESEARCH_KEYWORDS if kw in lower)
    
    result_verbs = re.compile(r'\b(?:found|shows?|indicates?|improves?|outperforms?|achieves?|reduces?|increases?)\b', re.IGNORECASE)
    result_score = 4 if result_verbs.search(sentence) else 0
    
    early_paper_bonus = 2 if index < 80 else 0
    
    return keyword_score + result_score + early_paper_bonus

def local_summarize(text: str, max_words: int) -> str:
    cleaned = remove_unwanted_text(text)
    if not cleaned:
        return 'No readable text could be extracted from this PDF.'
        
    # Split sentences roughly by punctuation followed by space
    sentences = re.split(r'(?<=[.!?])\s+', cleaned)
    if not sentences:
        sentences = [cleaned]
        
    ranked_sentences = []
    for index, sentence in enumerate(sentences):
        cleaned_sentence = remove_unwanted_text(sentence).strip()
        if not cleaned_sentence:
            continue
        if is_useful_research_sentence(cleaned_sentence):
            score = score_research_sentence(cleaned_sentence, index)
            ranked_sentences.append({
                'sentence': cleaned_sentence,
                'index': index,
                'score': score
            })
            
    # Sort by score desc, then by index asc
    ranked_sentences.sort(key=lambda x: (-x['score'], x['index']))
    
    selected = []
    word_count = 0
    
    for item in ranked_sentences:
        sentence = item['sentence']
        if sentence in selected:
            continue
            
        sentence_words = count_words(sentence)
        if word_count > 0 and word_count + sentence_words > max_words:
            break
            
        selected.append(sentence)
        word_count += sentence_words
        
        if word_count >= max_words:
            break
            
    # Sort selected sentences back to their original document order for logical reading flow
    selected_with_indices = []
    for sentence in selected:
        orig_item = next(item for item in ranked_sentences if item['sentence'] == sentence)
        selected_with_indices.append(orig_item)
    selected_with_indices.sort(key=lambda x: x['index'])
    
    ordered_sentences = [item['sentence'] for item in selected_with_indices]
    summary = " ".join(ordered_sentences) if ordered_sentences else trim_to_words(cleaned, max_words)
    return trim_to_words(summary, max_words)

# ----------------- Endpoints -----------------

@app.get("/api/health")
def health():
    return {"ok": True}

@app.post("/api/auth/signup")
async def signup(req: SignupRequest):
    try:
        name = req.name.strip()
        email = req.email.strip().lower()
        password = req.password

        if not name or not email or not password:
            return JSONResponse(status_code=400, content={"message": "Name, email, and password are required."})

        if len(password) < 6:
            return JSONResponse(status_code=400, content={"message": "Password must be at least 6 characters."})

        # Check existing user
        existing_user = db.users.find_one({"email": email})
        if existing_user:
            return JSONResponse(status_code=409, content={"message": "An account with this email already exists."})

        # Hash password
        salt = bcrypt.gensalt(12)
        hashed_bytes = bcrypt.hashpw(password.encode('utf-8'), salt)
        password_hash = hashed_bytes.decode('utf-8')

        # Create user
        now = datetime.now(timezone.utc)
        user_doc = {
            "name": name,
            "email": email,
            "passwordHash": password_hash,
            "createdAt": now,
            "updatedAt": now,
            "__v": 0
        }
        result = db.users.insert_one(user_doc)
        user_doc["_id"] = result.inserted_id

        return JSONResponse(
            status_code=201,
            content={
                "user": {
                    "id": str(user_doc["_id"]),
                    "name": user_doc["name"],
                    "email": user_doc["email"]
                }
            }
        )
    except Exception as e:
        print(f"Signup error: {e}")
        return JSONResponse(status_code=500, content={"message": "Could not create the account."})

@app.post("/api/auth/login")
async def login(req: LoginRequest):
    try:
        email = req.email.strip().lower()
        password = req.password

        if not email or not password:
            return JSONResponse(status_code=400, content={"message": "Email and password are required."})

        user = db.users.find_one({"email": email})
        if not user:
            return JSONResponse(status_code=401, content={"message": "Invalid email or password."})

        # Verify password
        password_hash = user.get("passwordHash", "")
        if not password_hash or not bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8')):
            return JSONResponse(status_code=401, content={"message": "Invalid email or password."})

        return JSONResponse(
            content={
                "user": {
                    "id": str(user["_id"]),
                    "name": user["name"],
                    "email": user["email"]
                }
            }
        )
    except Exception as e:
        print(f"Login error: {e}")
        return JSONResponse(status_code=500, content={"message": "Could not log in."})

@app.post("/api/summarize")
async def summarize(pdf: UploadFile = File(...), maxWords: int = Form(300)):
    try:
        if not pdf:
            return JSONResponse(status_code=400, content={"message": "A PDF file is required."})

        data = await pdf.read()
        doc = fitz.open(stream=data, filetype="pdf")
        text = "".join(page.get_text() for page in doc)

        if not text.strip():
            return JSONResponse(content={"summary": "No readable text could be extracted from this PDF.", "maxWords": maxWords})

        # Try summarizing using Gemini if initialized
        if client:
            try:
                # Use gemini-2.0-flash as the standard public model
                prompt = f"""
You are an academic research assistant.

Analyze this research paper and return a summary of approximately {maxWords} words.
Please include:
1. Paper Title
2. Abstract Summary
3. Key Findings
4. Methodology
5. Conclusion
6. Future Work

Paper:
{text}
"""
                response = client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt
                )
                if response and response.text:
                    print("Summarized successfully using Gemini.")
                    return JSONResponse(content={"summary": response.text, "maxWords": maxWords})
            except Exception as gemini_err:
                print(f"Gemini summarization failed: {gemini_err}. Falling back to local summarizer...")

        # Fallback to local heuristic summarizer
        print("Using local sentence-ranking summarizer fallback.")
        summary = local_summarize(text, maxWords)
        return JSONResponse(content={"summary": summary, "maxWords": maxWords})

    except Exception as e:
        print(f"Summarize error: {e}")
        return JSONResponse(status_code=500, content={"message": "Could not summarize the PDF."})
