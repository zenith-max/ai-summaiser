import { useEffect, useRef, useState } from 'react';
import './App.css';
import bg from './assets/Back ground.png';
import example from './assets/example button.png';
import pin from './assets/pin.png';
import AuthModal from './components/AuthModal';
import Header from './components/Header';
import Sidebar from './components/Sidebar';

const PDF_DB_NAME = 'paper-summarizer-files';
const PDF_STORE_NAME = 'pdfs';
const PDF_KEY = 'current-pdf';
const HISTORY_STORAGE_PREFIX = 'paper-summarizer-history';
const API_URL = 'http://localhost:4000';
const MIN_SUMMARY_WORDS = 100;
const MAX_SUMMARY_WORDS = 600;
const EXAMPLE_PAPERS = [
  {
    id: 1,
    name: 'Research-Methods-in-Management.pdf',
    url: '/examples/Research-Methods-in-Management.pdf'
  },
  {
    id: 2,
    name: 'Benevolent-Sexism-on-Evaluations-of-Female-Leaders.pdf',
    url: '/examples/Benevolent-Sexism-on-Evaluations-of-Female-Leaders.pdf'
  },
  {
    id: 3,
    name: 'RL-and-Order-Flow-in-FX-Markets.pdf',
    url: '/examples/RL-and-Order-Flow-in-FX-Markets.pdf'
  },
  {
    id: 4,
    name: 'EJ1172284.pdf',
    url: '/examples/EJ1172284.pdf'
  }
];

const sanitizePdfText = (value) =>
  value
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const escapePdfText = (value) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const wrapText = (text, maxLineLength) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;

    if (nextLine.length > maxLineLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
};

const buildSummaryPdf = (title, summaryText) => {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 54;
  const lineHeight = 16;
  const maxLinesPerPage = 44;
  const titleLines = wrapText(sanitizePdfText(title), 58);
  const summaryLines = wrapText(sanitizePdfText(summaryText), 82);
  const allLines = [...titleLines, '', ...summaryLines];
  const pages = [];

  for (let index = 0; index < allLines.length; index += maxLinesPerPage) {
    pages.push(allLines.slice(index, index + maxLinesPerPage));
  }

  if (!pages.length) {
    pages.push(['Summary']);
  }

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  pages.forEach((pageLines, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const contentLines = ['BT', `/F1 ${index === 0 ? 14 : 12} Tf`, `${margin} ${pageHeight - margin} Td`];

    pageLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        contentLines.push(`0 -${lineHeight} Td`);
      }

      if (line) {
        contentLines.push(`(${escapePdfText(line)}) Tj`);
      }

      if (index === 0 && lineIndex === titleLines.length - 1) {
        contentLines.push('/F1 12 Tf');
      }
    });

    contentLines.push('ET');

    const content = contentLines.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
};

const openPdfDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(PDF_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const savePdfFile = async (file) => {
  const db = await openPdfDb();
  const transaction = db.transaction(PDF_STORE_NAME, 'readwrite');
  transaction.objectStore(PDF_STORE_NAME).put(
    {
      blob: file,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified
    },
    PDF_KEY
  );
};

const loadPdfFile = async () => {
  const db = await openPdfDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE_NAME, 'readonly');
    const request = transaction.objectStore(PDF_STORE_NAME).get(PDF_KEY);

    request.onsuccess = () => {
      const stored = request.result;
      if (!stored) {
        resolve(null);
        return;
      }

      resolve(new File([stored.blob], stored.name, {
        type: stored.type || 'application/pdf',
        lastModified: stored.lastModified
      }));
    };
    request.onerror = () => reject(request.error);
  });
};

const clearPdfFile = async () => {
  const db = await openPdfDb();
  const transaction = db.transaction(PDF_STORE_NAME, 'readwrite');
  transaction.objectStore(PDF_STORE_NAME).delete(PDF_KEY);
};

const getUserHistoryKey = (user) => `${HISTORY_STORAGE_PREFIX}:${user?.id || user?.email || 'guest'}`;

const getPdfHistoryKey = (user, id) => `${getUserHistoryKey(user)}:${id}`;

const loadPdfByKey = async (key) => {
  const db = await openPdfDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE_NAME, 'readonly');
    const request = transaction.objectStore(PDF_STORE_NAME).get(key);

    request.onsuccess = () => {
      const stored = request.result;
      if (!stored) {
        resolve(null);
        return;
      }

      resolve(new File([stored.blob], stored.name, {
        type: stored.type || 'application/pdf',
        lastModified: stored.lastModified
      }));
    };
    request.onerror = () => reject(request.error);
  });
};

const savePdfByKey = async (key, file) => {
  const db = await openPdfDb();
  const transaction = db.transaction(PDF_STORE_NAME, 'readwrite');
  transaction.objectStore(PDF_STORE_NAME).put(
    {
      blob: file,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified
    },
    key
  );
};

const deletePdfByKey = async (key) => {
  const db = await openPdfDb();
  const transaction = db.transaction(PDF_STORE_NAME, 'readwrite');
  transaction.objectStore(PDF_STORE_NAME).delete(key);
};

export default function App() {
  const [open, setOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('paper-summarizer-user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileUrl, setSelectedFileUrl] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [summary, setSummary] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryWordLimit, setSummaryWordLimit] = useState(300);
  const [pdfHistory, setPdfHistory] = useState([]);
  const [summaryOpen, setSummaryOpen] = useState(
    () => localStorage.getItem('paper-summarizer-summary-open') === 'true'
  );
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setPdfHistory([]);
      return;
    }

    const savedHistory = localStorage.getItem(getUserHistoryKey(user));
    setPdfHistory(savedHistory ? JSON.parse(savedHistory) : []);
  }, [user]);

  useEffect(() => {
    const restorePdf = async () => {
      const storedFile = await loadPdfFile();
      if (storedFile) {
        setSelectedFile(storedFile);
      } else {
        setSummaryOpen(false);
        localStorage.removeItem('paper-summarizer-summary-open');
      }
    };

    if (summaryOpen && !selectedFile) {
      restorePdf();
    }
  }, [summaryOpen, selectedFile]);

  useEffect(() => {
    if (!selectedFile) {
      setSelectedFileUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setSelectedFileUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const handleAuth = (authUser) => {
    setUser(authUser);
    localStorage.setItem('paper-summarizer-user', JSON.stringify(authUser));
    setUploadError('');
  };

  const handleLogout = () => {
    setUser(null);
    setSelectedFile(null);
    setSummaryOpen(false);
    localStorage.removeItem('paper-summarizer-user');
    localStorage.removeItem('paper-summarizer-summary-open');
    clearPdfFile();
  };

  const requireLogin = () => {
    if (user) return true;

    setUploadError('Please login before uploading a PDF.');
    setShowAuth(true);
    return false;
  };

  const addPdfToHistory = async (file) => {
    if (!user) return;

    const duplicateItems = pdfHistory.filter((item) => item.name === file.name);
    await Promise.all(duplicateItems.map((item) => deletePdfByKey(item.pdfKey)));

    const id = `${Date.now()}-${file.name}`;
    const pdfKey = getPdfHistoryKey(user, id);
    const historyItem = {
      id,
      name: file.name,
      pdfKey,
      addedAt: new Date().toISOString()
    };

    await savePdfByKey(pdfKey, file);

    setPdfHistory((current) => {
      const withoutDuplicate = current.filter((item) => item.name !== file.name);
      const nextHistory = [historyItem, ...withoutDuplicate].slice(0, 12);
      localStorage.setItem(getUserHistoryKey(user), JSON.stringify(nextHistory));
      return nextHistory;
    });
  };

  const selectPdfFile = async (file) => {
    if (!requireLogin()) return;
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setSelectedFile(null);
      setUploadError('Only PDF files are allowed.');
      return;
    }

    setSelectedFile(file);
    setSummaryOpen(false);
    localStorage.removeItem('paper-summarizer-summary-open');
    await savePdfFile(file);
    await addPdfToHistory(file);
    setUploadError('');
  };

  const openHistoryPdf = async (historyItem) => {
    if (!requireLogin()) return;

    try {
      const file = await loadPdfByKey(historyItem.pdfKey);

      if (!file) {
        throw new Error('This PDF is no longer available in history.');
      }

      setSelectedFile(file);
      setSummary('');
      setSummaryOpen(false);
      setOpen(false);
      localStorage.removeItem('paper-summarizer-summary-open');
      await savePdfFile(file);
      setUploadError('');
    } catch (error) {
      setUploadError(error.message || 'Could not open the history PDF.');
    }
  };

  const handleFileChange = (event) => {
    selectPdfFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (!user) return;
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    selectPdfFile(event.dataTransfer.files?.[0]);
  };

  const selectExamplePaper = async (paper) => {
    if (!paper.url) return;
    if (!requireLogin()) return;

    try {
      const response = await fetch(paper.url);

      if (!response.ok) {
        throw new Error('Could not load the example PDF.');
      }

      const blob = await response.blob();
      const file = new File([blob], paper.name, {
        type: 'application/pdf',
        lastModified: Date.now()
      });

      await selectPdfFile(file);
    } catch (error) {
      setUploadError(error.message || 'Could not load the example PDF.');
    }
  };

  const downloadSummaryPdf = () => {
    if (!summary.trim() || isSummarizing) return;

    const sourceName = selectedFile?.name?.replace(/\.pdf$/i, '') || 'paper';
    const fileName = `${sourceName}-summary.pdf`;
    const pdfBlob = buildSummaryPdf(`Summary: ${selectedFile?.name || 'Selected PDF'}`, summary);
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');

    link.href = pdfUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 1000);
  };

  const openSummaryView = async () => {
    if (!requireLogin() || !selectedFile) return;

    try {
      setIsSummarizing(true);
      setSummaryOpen(true);
      localStorage.setItem('paper-summarizer-summary-open', 'true');

      const formData = new FormData();
      formData.append('pdf', selectedFile);
      formData.append('maxWords', String(summaryWordLimit));

      const response = await fetch(`${API_URL}/api/summarize`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to summarize PDF.');
      }

      setSummary(data.summary);
    } catch (err) {
      console.error(err);
      setSummary(err.message || 'Failed to summarize PDF.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const startNewSummary = () => {
    setSummaryOpen(false);
    setSelectedFile(null);
    setSummary('');
    setUploadError('');
    localStorage.removeItem('paper-summarizer-summary-open');
    clearPdfFile();
  };

  if (summaryOpen && !selectedFileUrl) {
    return (
      <div className="summary-page">
        <div className="summary-topbar">
          <button className="summary-pill" type="button" onClick={() => setSummaryOpen(false)}>
            Back
          </button>
          <button className="summary-pill" type="button" onClick={startNewSummary}>
            + New
          </button>
        </div>
        <div className="summary-loading">Loading PDF...</div>
      </div>
    );
  }

  if (summaryOpen && selectedFileUrl) {
    return (
      <div className="summary-page">
        <div className="summary-topbar">
          <button className="summary-pill" type="button" onClick={() => setSummaryOpen(false)}>
            Back
          </button>
          <button className="summary-pill" type="button" onClick={startNewSummary}>
            + New
          </button>
        </div>

        <div className="summary-toolbar">
          <div className="pdf-controls" />
          <div className="summary-actions">
            <button className="edit-btn" type="button">Edit v</button>
            <button
              className="download-btn"
              type="button"
              aria-label="Download summary as PDF"
              title="Download summary as PDF"
              disabled={!summary.trim() || isSummarizing}
              onClick={downloadSummaryPdf}
            >
              PDF
            </button>
          </div>
        </div>

        <main className="reader-grid">
          <section className="pdf-pane" aria-label="Uploaded PDF">
            <div className="pdf-scroll">
              <object className="pdf-frame" data={selectedFileUrl} type="application/pdf">
                <a href={selectedFileUrl} target="_blank" rel="noreferrer">
                  Open selected PDF
                </a>
              </object>
            </div>
          </section>

          <section className="summary-pane" aria-label="Summarized text">
            <article className="summary-paper">
              <h2>Summary</h2>
              {isSummarizing ? (
              <p>Generating summary...</p>
              ) : (
                 <div className="summary-content">
                  {summary}
                 </div>
              )}
              <p>
                Selected PDF: <strong>{selectedFile.name}</strong>
              </p>
            </article>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app" style={{ backgroundImage: `url(${bg})` }}>
      <Header
        toggleSidebar={() => setOpen((current) => !current)}
        user={user}
        onLoginClick={() => setShowAuth(true)}
      />
      <Sidebar
        open={open}
        user={user}
        history={pdfHistory}
        onHistoryClick={openHistoryPdf}
        onLogout={handleLogout}
      />
      {open && (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuth={handleAuth} />}

      <main>
        <section className="content-section">
          <h1 className="title">AI Paper Summarizer - Summarize Research Papers</h1>
          <p className="subtitle">
            Transform lengthy research papers into clear, concise insights in seconds.
          </p>

          <div className="upload-card">
            <div
              className={`drop-zone ${isDragging ? 'dragging' : ''} ${user ? '' : 'locked'}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (!user) {
                  requireLogin();
                }
              }}
            >
              {user ? 'Select or drag and drop PDF files here' : 'Login to upload PDF files'}
            </div>
            <div className="upload-controls">
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
              />
              <button
                className="upload-btn"
                type="button"
                onClick={() => {
                  if (requireLogin()) {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <img src={pin} alt="" />
                Upload File
              </button>
              <button
                className="summarize-btn"
                type="button"
                disabled={!user || !selectedFile}
                onClick={openSummaryView}
              >
                Summarize
              </button>
              <label className="length-control">
                <span>Length: {summaryWordLimit} words</span>
                <input
                  type="range"
                  min={MIN_SUMMARY_WORDS}
                  max={MAX_SUMMARY_WORDS}
                  step="50"
                  value={summaryWordLimit}
                  onChange={(event) => setSummaryWordLimit(Number(event.target.value))}
                />
              </label>
            </div>
            {(selectedFile || uploadError) && (
              <p className={`file-status ${uploadError ? 'error' : ''}`}>
                {uploadError || `Selected: ${selectedFile.name}`}
              </p>
            )}
          </div>

          <div className="examples" aria-label="Example papers">
            {EXAMPLE_PAPERS.map((paper) => (
              <button
                className="example-card"
                type="button"
                key={paper.id}
                onClick={() => selectExamplePaper(paper)}
              >
                <img src={example} alt={`Example ${paper.id}`} className="example-img" />
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
