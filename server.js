require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves your frontend f
const ai = new GoogleGenAI();


const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );
`).then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Database connection error:', err));
const chatHistories = {};

async function generateWithFallback(history) {
   const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    let lastError;

    for (const model of models) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: history, // Passes the full back-and-forth conversation!
                config: {
                    systemInstruction:
                        "You are an insightful, engaging, and knowledgeable AI companion. " +
                        "You can discuss any topic in depth—science, coding, history, sports, everyday advice, or creative ideas. " +
                        "Be conversational, clear, and naturally curious, using formatting like bullet points or code blocks when helpful.",
                   // tools: [{ googleSearch: {} }],
                },
            });

            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const sources = chunks
                .filter((chunk) => chunk.web?.uri)
                .map((chunk) => ({
                    title: chunk.web.title || chunk.web.uri,
                    url: chunk.web.uri,
                }));

            return {
                reply: response.text,
                sources,
            };
        } catch (err) {
            lastError = err;
            if (err.status !== 503 && err.status !== 429) throw err;
        }
    }
    throw lastError;
}
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2)',
            [username, hashedPassword]
        );

        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        console.error('Register Error:', err);
        res.status(500).json({ error: 'Internal server error during registration' });
    }
});

// Auth: Login Route
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }

        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

app.post('/api/chat/send', verifyToken, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        const username = req.user.username;
        if (!chatHistories[username]) {
            chatHistories[username] = [];
        }

        // 1. Add user's message to history
        chatHistories[username].push({
            role: 'user',
            parts: [{ text: message }],
        });

        // Keep the last 20 turns so requests stay fast
        if (chatHistories[username].length > 20) {
            chatHistories[username] = chatHistories[username].slice(-20);
        }

        // 2. Generate reply using the full conversation history
        const result = await generateWithFallback(chatHistories[username]);

        // 3. Save AI's reply to history
        chatHistories[username].push({
            role: 'model',
            parts: [{ text: result.reply }],
        });

        res.json(result);
    } catch (err) {
        console.error('Gemini API Error Details:', err);
        res.status(err.status || 500).json({
            error: err.message || 'Failed to generate AI response',
        });
    }
});
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});
// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://127.0.0.1:${PORT}`);
});