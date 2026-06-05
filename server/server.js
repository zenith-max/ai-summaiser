import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();

app.use(cors());

const upload = multer({
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

app.post(
  "/api/summarize",
  upload.single("pdf"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No PDF uploaded",
        });
      }

      const pdf = await pdfParse(
        req.file.buffer
      );

      const text = pdf.text;

      const prompt = `
You are an academic research assistant.

Analyze this research paper and return:

1. Paper Title
2. Abstract Summary
3. Key Findings
4. Methodology
5. Conclusion
6. Future Work

Paper:

${text}
`;

      const result =
        await model.generateContent(prompt);

      const summary =
        result.response.text();

      res.json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: "Failed to summarize PDF",
      });
    }
  }
);

app.listen(5000, () => {
  console.log(
    "Server running on http://localhost:5000"
  );
});    