import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

const clampWordLimit = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 300;
  }

  return Math.min(Math.max(Math.round(parsed), 100), 600);
};

const countWords = (value) => value.trim().split(/\s+/).filter(Boolean).length;

const trimToWords = (value, maxWords) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ');
};

const removeUnwantedText = (value) =>
  value
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' ')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
    .replace(/\b(?:doi|isbn|issn)\s*[:/]\s*\S+/gi, ' ')
    .replace(/\b(?:fig(?:ure)?|image|photo|diagram|chart|graph|table)\s*\.?\s*\d+[a-z]?\b[^.!?]*[.!?]?/gi, ' ')
    .replace(/\b(?:page|vol(?:ume)?|issue|no)\s+\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const junkSentencePatterns = [
  /\b(?:copyright|all rights reserved|permission|license|terms of use)\b/i,
  /\b(?:phone|mobile|tel|fax|email|e-mail|address|corresponding author)\b/i,
  /\b(?:www\.|https?:|@)\b/i,
  /\b(?:figure|fig\.|image|photo|diagram|chart|graph|table)\b/i,
  /\b(?:references|bibliography|acknowledg(?:e)?ments)\b/i,
  /^\s*\d+\s*$/,
  /^[^a-zA-Z]*$/
];

const researchKeywords = [
  'abstract',
  'objective',
  'purpose',
  'problem',
  'method',
  'approach',
  'model',
  'framework',
  'dataset',
  'experiment',
  'evaluation',
  'result',
  'finding',
  'accuracy',
  'performance',
  'analysis',
  'contribution',
  'proposed',
  'demonstrate',
  'conclude',
  'limitation',
  'future work'
];

const isUsefulResearchSentence = (sentence) => {
  const words = countWords(sentence);
  const lower = sentence.toLowerCase();

  if (words < 8 || words > 55) {
    return false;
  }

  if (junkSentencePatterns.some((pattern) => pattern.test(sentence))) {
    return false;
  }

  const digitCount = (sentence.match(/\d/g) || []).length;
  if (digitCount > sentence.length * 0.25) {
    return false;
  }

  return /[a-z]{3,}/i.test(sentence) && researchKeywords.some((keyword) => lower.includes(keyword));
};

const scoreResearchSentence = (sentence, index) => {
  const lower = sentence.toLowerCase();
  const keywordScore = researchKeywords.reduce(
    (score, keyword) => score + (lower.includes(keyword) ? 3 : 0),
    0
  );
  const resultScore = /\b(?:found|shows?|indicates?|improves?|outperforms?|achieves?|reduces?|increases?)\b/i.test(sentence)
    ? 4
    : 0;
  const earlyPaperBonus = index < 80 ? 2 : 0;

  return keywordScore + resultScore + earlyPaperBonus;
};

const summarizeText = (text, maxWords) => {
  const cleaned = removeUnwantedText(text);

  if (!cleaned) {
    return 'No readable text could be extracted from this PDF.';
  }

  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  const rankedSentences = sentences
    .map((sentence, index) => ({ sentence: removeUnwantedText(sentence).trim(), index }))
    .filter(({ sentence }) => isUsefulResearchSentence(sentence))
    .map((item) => ({ ...item, score: scoreResearchSentence(item.sentence, item.index) }))
    .sort((first, second) => second.score - first.score || first.index - second.index);
  const selected = [];
  let wordCount = 0;

  for (const { sentence } of rankedSentences) {
    if (selected.includes(sentence)) continue;

    const sentenceWords = countWords(sentence);
    if (wordCount > 0 && wordCount + sentenceWords > maxWords) {
      break;
    }

    selected.push(sentence);
    wordCount += sentenceWords;

    if (wordCount >= maxWords) {
      break;
    }
  }

  const summary = selected.join(' ') || trimToWords(cleaned, maxWords);
  return trimToWords(summary, maxWords);
};

app.post('/api/summarize', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'A PDF file is required.' });
    }

    const parser = new PDFParse({ data: req.file.buffer });
    const result = await parser.getText();
    await parser.destroy();

    const maxWords = clampWordLimit(req.body.maxWords);

    return res.json({ summary: summarizeText(result.text || '', maxWords), maxWords });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Could not summarize the PDF.' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash });

    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Could not create the account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordsMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordsMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Could not log in.' });
  }
});

if (!process.env.MONGO_URI) {
  throw new Error('MONGO_URI is missing. Add it to .env before starting the server.');
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(port, () => {
      console.log(`API server running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });
