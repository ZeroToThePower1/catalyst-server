const { Server } = require('socket.io');
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');

const app = express();

// CORS CONFIG - Added your Netlify frontend URL
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://127.0.0.1:3000', 
        'http://localhost:3001', 
        'http://localhost:5500', 
        'http://127.0.0.1:5500', 
        'http://127.0.0.1:3001',
        'https://catalystt-frontend.netlify.app',
        'https://zerotothepower1.github.io'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authenticate', 'x-refresh-token', 'x-access-token']
}));

app.use(express.json());
app.use(cookieParser());

// JWT Durations
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "alskd123";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "werwdkl14444";
const ACCESS_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_EXPIRY = '30d';

// MongoDB connection - UPDATED WITH YOUR CONNECTION STRING
mongoose.connect('mongodb+srv://chaudharsami324_db_user:HjtGZkrBRRxwcW9h@cluster0.hmsc2is.mongodb.net/catalyst?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => {
        console.log('✅ Database connected to MongoDB Atlas');
    })
    .catch((err) => {
        console.log('❌ Database error:', err);
    });

// User Schema
const userSchema = new mongoose.Schema({
    id: Number,
    Name: {
        type: String,
        required: true,
    },
    Username: {
        type: String,
        required: true,
        unique: true
    },
    Hashedpassword: String,
});

// Chat Schema - UPDATED: Auto delete after 12 hours (43200 seconds)
const savedChatSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    roomId: String,
    username: String,
    message: String,
    timestamp: { type: Date, default: Date.now, expires: 43200 } // 12 hours = 43200 seconds
});

const refreshTokenSchema = new mongoose.Schema({
    token: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    createdAt: { type: Date, default: Date.now, expires: '30d' }
});

const noteslinks = new mongoose.Schema({
    title: String,
    url: String
});

const mocklinks = new mongoose.Schema({
    title: String,
    url: String
});

const gameRoomSchema = new mongoose.Schema({
    roomCode: String,
    players: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
        username: String,
        score: { type: Number, default: 0 },
        isReady: { type: Boolean, default: false },
        joinedAt: { type: Date, default: Date.now },
        answeredCurrentQuestion: { type: Boolean, default: false },
        lastAnswerIndex: Number,
        lastAnswerCorrect: Boolean
    }],
    gameState: {
        type: String,
        enum: ['waiting', 'playing', 'finished'],
        default: 'waiting'
    },
    currentQuestion: Object,
    questionIndex: { type: Number, default: 0 },
    questions: Array,
    createdAt: { type: Date, default: Date.now, expires: 3600 }
});

// REMOVED: gameLeaderboardSchema
// REMOVED: GameLeaderboardModel

const gameInviteSchema = new mongoose.Schema({
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    fromUsername: String,
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    roomCode: String,
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});

const GameRoomModel = mongoose.model("gamerooms", gameRoomSchema);
// REMOVED: GameLeaderboardModel
const GameInviteModel = mongoose.model("gameinvites", gameInviteSchema);
const noteslinks_model = mongoose.model("notes-links", noteslinks);
const UserModel = mongoose.model("users", userSchema);
const refreshTokenModel = mongoose.model('refreshtoken', refreshTokenSchema);
const savedChatModel = mongoose.model("savechats", savedChatSchema);
const mocklinks_model = mongoose.model("mock-links", mocklinks);

// ==================== UTILITY FUNCTIONS ====================

// Updated fallback questions to match expected format
function getFallbackQuestions() {
    return [
        {
            "Question": "What is the capital of France?",
            "Correct": "Paris",
            "OptionOne": "London",
            "OptionTwo": "Berlin",
            "OptionThree": "Madrid"
        },
        {
            "Question": "Which planet is known as the Red Planet?",
            "Correct": "Mars",
            "OptionOne": "Venus",
            "OptionTwo": "Jupiter",
            "OptionThree": "Saturn"
        },
        {
            "Question": "What is the largest mammal in the world?",
            "Correct": "Blue Whale",
            "OptionOne": "Elephant",
            "OptionTwo": "Giraffe",
            "OptionThree": "Polar Bear"
        },
        {
            "Question": "Who wrote 'Romeo and Juliet'?",
            "Correct": "William Shakespeare",
            "OptionOne": "Charles Dickens",
            "OptionTwo": "Jane Austen",
            "OptionThree": "Mark Twain"
        },
        {
            "Question": "What is the chemical symbol for water?",
            "Correct": "H₂O",
            "OptionOne": "CO₂",
            "OptionTwo": "O₂",
            "OptionThree": "NaCl"
        }
    ];
}

// FIXED: Shuffle function for correct question structure
const shuffleQuestionsAndRecalcCorrectIndex = (rawQuestions) => {
    if (!Array.isArray(rawQuestions)) return [];
    
    return rawQuestions.map((rawQuestion, index) => {
        if (!rawQuestion) return null;
        
        // Extract all available options from the raw question
        const allOptions = [];
        
        // Add the correct answer first
        if (rawQuestion.Correct && rawQuestion.Correct.trim() !== '') {
            allOptions.push(rawQuestion.Correct.trim());
        }
        
        // Add OptionOne, OptionTwo, OptionThree
        if (rawQuestion.OptionOne && rawQuestion.OptionOne.trim() !== '') {
            allOptions.push(rawQuestion.OptionOne.trim());
        }
        if (rawQuestion.OptionTwo && rawQuestion.OptionTwo.trim() !== '') {
            allOptions.push(rawQuestion.OptionTwo.trim());
        }
        if (rawQuestion.OptionThree && rawQuestion.OptionThree.trim() !== '') {
            allOptions.push(rawQuestion.OptionThree.trim());
        }
        
        // Ensure we have at least 2 options
        if (allOptions.length < 2) {
            console.warn(`Question ${index} has insufficient options:`, rawQuestion);
            allOptions.push(...['Option A', 'Option B', 'Option C']);
        }
        
        // Remember original correct answer
        const originalCorrect = (rawQuestion.Correct || '').trim();
        
        // Fisher-Yates shuffle algorithm
        const shuffledOptions = [...allOptions];
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
        }
        
        // Find the new correct index after shuffling
        const correctIndex = shuffledOptions.findIndex(
            option => option.toLowerCase().trim() === originalCorrect.toLowerCase().trim()
        );
        
        // If correct answer not found in shuffled options, default to 0
        const finalCorrectIndex = correctIndex >= 0 ? correctIndex : 0;
        
        console.log(`Q${index + 1}: Original correct="${originalCorrect}"`, 
                   `Shuffled options:`, shuffledOptions,
                   `New correct index: ${finalCorrectIndex}`);
        
        return {
            questionId: index,
            text: rawQuestion.Question || `Question ${index + 1}`,
            options: shuffledOptions,
            correctIndex: finalCorrectIndex,
            originalCorrect: originalCorrect
        };
    }).filter(q => q !== null);
};

const prepareQuestionForDisplay = (transformedQuestion) => {
    if (!transformedQuestion) return null;
    
    return {
        text: transformedQuestion.text,
        options: transformedQuestion.options, 
        correctIndex: transformedQuestion.correctIndex,
        questionId: transformedQuestion.questionId
    };
};

// REMOVED: updateLeaderboard function

// Helper function to fetch questions from URL
async function fetchQuestionsFromUrl(url) {
    try {
        console.log(`📡 Fetching questions from: ${url}`);
        const response = await axios.get(url, { timeout: 8000 });

        if (response.data && response.data.questions && Array.isArray(response.data.questions)) {
            console.log(`✅ Found ${response.data.questions.length} questions from ${url}`);
            return response.data.questions;
        } else if (Array.isArray(response.data)) {
            console.log(`✅ Found ${response.data.length} questions from ${url}`);
            return response.data;
        } else {
            console.log(`⚠️ No questions found at ${url}`);
            return [];
        }
    } catch (error) {
        console.error(`❌ Error fetching from ${url}:`, error.message);
        return [];
    }
}

// Helper function to get winner
function getWinner(players) {
    if (!players || players.length === 0) return null;
    if (players.length === 1) return players[0];

    const sorted = [...players].sort((a, b) => b.score - a.score);
    if (sorted[0].score === sorted[1].score) return null; // Draw
    return sorted[0];
}

// Authentication middleware
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization ||
        req.headers.authenticate ||
        req.headers['x-access-token'];

    if (!authHeader) {
        return res.status(401).json({ message: "Access token required" });
    }

    let token;
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else {
        token = authHeader;
    }

    if (!token) {
        return res.status(401).json({ message: "Access token required" });
    }

    jwt.verify(token, ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: "Invalid or expired token" });
        }
        req.user = decoded;
        next();
    });
}

const socketAuthenticate = async (socket, next) => {
    try {
        let token = socket.handshake.auth.token ||
            socket.handshake.headers.authorization ||
            socket.handshake.headers.authenticate;

        if (token && token.startsWith('Bearer ')) {
            token = token.substring(7);
        }

        if (!token) {
            return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
        const user = await UserModel.findById(decoded.userId);

        if (!user) {
            return next(new Error('User not found'));
        }

        socket.userId = user._id;
        socket.username = user.Username;
        next();

    } catch (err) {
        console.error('Socket auth error:', err.message);
        next(new Error('Authentication failed'));
    }
};

// ==================== AUTH ENDPOINTS ====================
app.post('/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshtoken;

        if (refreshToken) {
            await refreshTokenModel.deleteOne({ token: refreshToken });
        }

        res.clearCookie('refreshtoken');
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post("/signup", async (req, res) => {
    try {
        const { name, username, password } = req.body;

        if (!name || !username || !password) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const existingUser = await UserModel.findOne({ Username: username });
        if (existingUser) {
            return res.status(400).json({ message: "Username already exists" });
        }

        const hashedpassword = await bcrypt.hash(password, 10);
        const userCount = await UserModel.countDocuments();

        const document = await UserModel.create({
            id: userCount + 1,
            Name: name,
            Username: username,
            Hashedpassword: hashedpassword
        });

        const accessToken = jwt.sign(
            { userId: document._id, username: document.Username },
            ACCESS_TOKEN_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );

        const refreshToken = jwt.sign(
            { userId: document._id },
            REFRESH_TOKEN_SECRET,
            { expiresIn: REFRESH_TOKEN_EXPIRY }
        );

        await refreshTokenModel.create({
            token: refreshToken,
            userId: document._id
        });

        res.cookie("refreshtoken", refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.json({
            message: "User created successfully",
            accesstoken: accessToken,
            user: {
                id: document._id,
                name: document.Name,
                username: document.Username
            }
        });

    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: "Username and password are required" });
        }

        const userIn_db = await UserModel.findOne({ Username: username });
        if (!userIn_db) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const isValid = await bcrypt.compare(password, userIn_db.Hashedpassword);
        if (!isValid) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const accessToken = jwt.sign(
            { userId: userIn_db._id, username: userIn_db.Username },
            ACCESS_TOKEN_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );

        const refreshToken = jwt.sign(
            { userId: userIn_db._id },
            REFRESH_TOKEN_SECRET,
            { expiresIn: REFRESH_TOKEN_EXPIRY }
        );

        await refreshTokenModel.create({
            token: refreshToken,
            userId: userIn_db._id
        });

        res.cookie("refreshtoken", refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.json({
            message: "Login successful",
            accesstoken: accessToken,
            user: {
                id: userIn_db._id,
                name: userIn_db.Name,
                username: userIn_db.Username
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// ==================== CHAT ENDPOINTS ====================
app.get("/users", authenticate, async (req, res) => {
    try {
        const users = await UserModel.find(
            { _id: { $ne: req.user.userId } },
            { _id: 1, Username: 1, Name: 1 }
        ).limit(50);

        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.get("/chat/private/:otherUserId", authenticate, async (req, res) => {
    try {
        const { otherUserId } = req.params;
        const userId = req.user.userId;

        const roomId = [userId, otherUserId].sort().join('-');

        const messages = await savedChatModel.find({ roomId })
            .sort({ timestamp: 1 })
            .limit(100);

        res.json(messages);
    } catch (error) {
        console.error('Get chat error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Cleanup old chats endpoint (optional)
app.post('/chat/cleanup', authenticate, async (req, res) => {
    try {
        // MongoDB TTL index will auto-delete chats after 12 hours
        // This endpoint is just for manual cleanup if needed
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const result = await savedChatModel.deleteMany({
            timestamp: { $lt: twelveHoursAgo }
        });
        
        res.json({
            message: `Cleaned up ${result.deletedCount} old chat messages`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Chat cleanup error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// ==================== GAME ENDPOINTS ====================
app.post('/games/join-random', authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const username = req.user.username;

        const waitingRoom = await GameRoomModel.findOne({
            gameState: 'waiting',
            $expr: { $lt: [{ $size: "$players" }, 2] }
        });

        if (waitingRoom) {
            const playerExists = waitingRoom.players.some(p => p.userId.toString() === userId);

            if (!playerExists) {
                waitingRoom.players.push({
                    userId,
                    username,
                    score: 0,
                    isReady: true
                });

                await waitingRoom.save();

                res.json({
                    roomCode: waitingRoom.roomCode,
                    players: waitingRoom.players,
                    message: 'Joined existing room'
                });
            } else {
                res.json({
                    roomCode: waitingRoom.roomCode,
                    players: waitingRoom.players,
                    message: 'Already in room'
                });
            }
        } else {
            const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

            const newRoom = await GameRoomModel.create({
                roomCode,
                players: [{
                    userId,
                    username,
                    score: 0,
                    isReady: true
                }],
                gameState: 'waiting',
                questions: []
            });

            res.json({
                roomCode: newRoom.roomCode,
                players: newRoom.players,
                message: 'Created new room'
            });
        }
    } catch (error) {
        console.error('Join random game error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/games/create-private', authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const username = req.user.username;
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const newRoom = await GameRoomModel.create({
            roomCode,
            players: [{
                userId,
                username,
                score: 0,
                isReady: false
            }],
            gameState: 'waiting'
        });

        res.json({
            roomCode: newRoom.roomCode,
            message: 'Private room created'
        });
    } catch (error) {
        console.error('Create private room error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/games/join-private/:roomCode', authenticate, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const userId = req.user.userId;
        const username = req.user.username;

        const room = await GameRoomModel.findOne({ roomCode });

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        if (room.players.length >= 2) {
            return res.status(400).json({ message: 'Room is full' });
        }

        const playerExists = room.players.some(p => p.userId.toString() === userId);
        if (playerExists) {
            return res.status(400).json({ message: 'Already in room' });
        }

        room.players.push({
            userId,
            username,
            score: 0,
            isReady: true
        });

        await room.save();

        res.json({
            roomCode: room.roomCode,
            players: room.players,
            message: 'Joined private room'
        });
    } catch (error) {
        console.error('Join private room error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Get questions endpoint
app.get('/games/questions', authenticate, async (req, res) => {
    try {
        let allQuestions = [];

        // Get mock links from database
        const mockLinks = await mocklinks_model.find().limit(5);
        console.log(`Found ${mockLinks.length} mock links`);

        // Fetch questions from each URL
        for (const mock of mockLinks) {
            if (mock.url) {
                const questions = await fetchQuestionsFromUrl(mock.url);
                allQuestions = allQuestions.concat(questions);

                if (allQuestions.length >= 20) {
                    console.log(`Got enough questions (${allQuestions.length}), stopping`);
                    break;
                }
            }
        }

        console.log(`Total questions collected from URLs: ${allQuestions.length}`);

        // If no questions found, use fallback
        if (allQuestions.length === 0) {
            console.log('No questions from URLs, using fallback');
            allQuestions = getFallbackQuestions();
        }

        // Shuffle and return questions
        const shuffledQuestions = [...allQuestions];
        for (let i = shuffledQuestions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledQuestions[i], shuffledQuestions[j]] = [shuffledQuestions[j], shuffledQuestions[i]];
        }

        res.json(shuffledQuestions.slice(0, 20));

    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Start game endpoint - FIXED
app.post('/games/start/:roomCode', authenticate, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const room = await GameRoomModel.findOne({ roomCode });

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        const player = room.players.find(p => p.userId.toString() === req.user.userId);
        if (!player) {
            return res.status(403).json({ message: 'Not in room' });
        }

        console.log('🎮 Loading questions for game...');

        let allQuestions = [];

        try {
            // Get mock links from database
            const mockLinks = await mocklinks_model.find().limit(3);
            console.log(`Found ${mockLinks.length} mock links`);

            // Fetch questions from each URL
            for (const mock of mockLinks) {
                if (mock.url) {
                    const questions = await fetchQuestionsFromUrl(mock.url);
                    allQuestions = allQuestions.concat(questions);

                    if (allQuestions.length >= 15) {
                        console.log(`Got enough questions (${allQuestions.length}), stopping`);
                        break;
                    }
                }
            }

            console.log(`Total raw questions collected: ${allQuestions.length}`);

            // If no questions found, use fallback
            if (allQuestions.length === 0) {
                console.log('No questions from URLs, using fallback');
                allQuestions = getFallbackQuestions();
            }

        } catch (error) {
            console.error('Error loading questions:', error);
            allQuestions = getFallbackQuestions();
        }

        // Shuffle and transform ALL questions on backend
        const transformedQuestions = shuffleQuestionsAndRecalcCorrectIndex(allQuestions);
        
        // Ensure we have at least 5 questions
        let finalQuestions = transformedQuestions;
        if (transformedQuestions.length < 5) {
            console.log(`Only ${transformedQuestions.length} questions available, adding fallback`);
            const fallback = shuffleQuestionsAndRecalcCorrectIndex(getFallbackQuestions());
            finalQuestions = transformedQuestions.concat(fallback.slice(0, 5 - transformedQuestions.length));
        }
        
        // Take exactly 5 questions for the game
        const gameQuestions = finalQuestions.slice(0, 5);
        console.log(`✅ Selected ${gameQuestions.length} shuffled questions for the game`);
        
        // DEBUG: Log correct answers
        gameQuestions.forEach((q, idx) => {
            console.log(`Q${idx + 1}: Correct index=${q.correctIndex}, Answer="${q.options[q.correctIndex]}"`);
        });

        // Store ORIGINAL transformed questions in room
        room.questions = gameQuestions; // This now has correctIndex
        room.questionIndex = 0;
        room.gameState = 'playing';
        room.currentQuestion = gameQuestions[0]; // Store the full transformed question

        await room.save();
        console.log('✅ Room saved with transformed questions');

        // Prepare question for frontend display
        const questionForFrontend = prepareQuestionForDisplay(gameQuestions[0]);

        // Emit to ALL players in the room with transformed questions
        const io = req.app.get('socketio');
        if (io) {
            io.to(`game-${roomCode}`).emit("gameStarted", {
                question: questionForFrontend,
                questions: gameQuestions.map(q => prepareQuestionForDisplay(q)), // Send ALL transformed questions
                questionNumber: 1,
                totalQuestions: gameQuestions.length
            });
            console.log(`📢 Emitted gameStarted with shuffled questions`);
        }

        res.json({
            question: questionForFrontend,
            questions: gameQuestions.map(q => prepareQuestionForDisplay(q)),
            questionNumber: 1,
            totalQuestions: gameQuestions.length
        });

    } catch (error) {
        console.error('Start game error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Next question endpoint (not used by frontend but keeping for compatibility)
app.post('/games/next-question/:roomCode', authenticate, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const room = await GameRoomModel.findOne({ roomCode });

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        if (room.gameState !== 'playing') {
            return res.status(400).json({ message: 'Game not active' });
        }

        console.log(`Current question index: ${room.questionIndex}, Total questions: ${room.questions?.length || 0}`);

        // Check if there are more questions
        if (room.questionIndex < (room.questions?.length || 0) - 1) {
            room.questionIndex += 1;
            const nextQuestion = room.questions[room.questionIndex];
            room.currentQuestion = nextQuestion;
            await room.save();

            console.log(`✅ Moving to question ${room.questionIndex + 1}`);

            // Emit to WebSocket
            const io = req.app.get('socketio');
            if (io) {
                io.to(`game-${roomCode}`).emit("nextQuestion", {
                    question: prepareQuestionForDisplay(nextQuestion),
                    questionNumber: room.questionIndex + 1,
                    totalQuestions: room.questions.length,
                    scores: room.players.map(p => ({
                        username: p.username,
                        score: p.score,
                        userId: p.userId
                    }))
                });
                console.log(`📢 Emitted nextQuestion for question ${room.questionIndex + 1}`);
            }

            res.json({
                question: prepareQuestionForDisplay(nextQuestion),
                questionNumber: room.questionIndex + 1,
                totalQuestions: room.questions.length,
                scores: room.players.map(p => ({
                    username: p.username,
                    score: p.score,
                    userId: p.userId
                })),
                gameState: 'playing'
            });
        } else {
            // Game finished
            console.log('🎯 Game finished - no more questions');
            room.gameState = 'finished';
            await room.save();

            // Emit game finished
            const io = req.app.get('socketio');
            if (io) {
                io.to(`game-${roomCode}`).emit("gameFinished", {
                    scores: room.players.map(p => ({
                        username: p.username,
                        score: p.score,
                        userId: p.userId
                    })),
                    winner: getWinner(room.players)
                });
                console.log(`📢 Emitted gameFinished for room ${roomCode}`);
            }

            res.json({
                gameState: 'finished',
                scores: room.players.map(p => ({ username: p.username, score: p.score })),
                winner: getWinner(room.players)
            });
        }
    } catch (error) {
        console.error('Next question error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// ANSWER SUBMISSION ENDPOINT - FIXED
app.post('/games/answer/:roomCode', authenticate, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const { questionIndex, answerIndex } = req.body;
        const userId = req.user.userId;

        console.log(`🎯 Answer from ${userId} for Q${questionIndex + 1}: ${answerIndex}`);

        const room = await GameRoomModel.findOne({ roomCode });

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        if (room.gameState !== 'playing') {
            return res.status(400).json({ message: 'Game not active' });
        }

        const player = room.players.find(p => p.userId.toString() === userId);
        if (!player) {
            return res.status(403).json({ message: 'Not in room' });
        }

        // Check if already answered THIS question using dynamic property
        // This is okay because we're just checking, not setting
        const answerKey = `answered_q${questionIndex}`;
        if (player[answerKey] !== undefined) {
            console.log(`Already answered Q${questionIndex + 1}`);
            return res.json({
                alreadyAnswered: true,
                scores: room.players.map(p => ({
                    userId: p.userId,
                    username: p.username,
                    score: p.score
                }))
            });
        }

        // Get the transformed question from room.questions
        const question = room.questions[questionIndex];
        if (!question) {
            return res.status(400).json({ message: 'Invalid question' });
        }

        // 🎯 BACKEND-ONLY VALIDATION
        const isCorrect = answerIndex === question.correctIndex;
        
        console.log(`Backend validation: answerIndex=${answerIndex}, correctIndex=${question.correctIndex}, correct=${isCorrect}`);
        console.log(`Selected: "${question.options[answerIndex]}"`);
        console.log(`Correct: "${question.options[question.correctIndex]}"`);

        // Update score if correct
        if (isCorrect) {
            player.score += 1;
        }

        // Mark this question as answered using dynamic property
        // This works because we're updating the document in memory before saving
        player[answerKey] = {
            answerIndex: answerIndex,
            isCorrect: isCorrect,
            correctAnswerIndex: question.correctIndex, // Send to frontend for display
            selectedOption: question.options[answerIndex],
            correctOption: question.options[question.correctIndex],
            timestamp: new Date()
        };

        await room.save();

        console.log(`✅ ${player.username} answered Q${questionIndex + 1}: ${isCorrect ? 'CORRECT' : 'WRONG'}, Score: ${player.score}`);

        // Check if game is complete (all 5 questions answered by this player)
        const playerAnsweredAll = [0, 1, 2, 3, 4].every(qIndex => {
            const key = `answered_q${qIndex}`;
            return player[key] !== undefined;
        });

        let response = {
            isCorrect: isCorrect,
            correctIndex: question.correctIndex, // Send for frontend display
            playerScore: player.score,
            scores: room.players.map(p => ({
                userId: p.userId,
                username: p.username,
                score: p.score
            })),
            questionIndex: questionIndex,
            totalQuestions: 5,
            selectedOption: question.options[answerIndex],
            correctOption: question.options[question.correctIndex]
        };

        // Check if both players answered ALL questions
        const bothPlayersCompleted = room.players.every(p => {
            return [0, 1, 2, 3, 4].every(qIndex => {
                const key = `answered_q${qIndex}`;
                return p[key] !== undefined;
            });
        });

        // If game completed by both players, end game
        if (bothPlayersCompleted) {
            console.log(`🏁 Both players completed all questions! Game finished.`);
            room.gameState = 'finished';
            await room.save();
            
            response.gameState = 'finished';
            
            // Emit game finished
            const io = req.app.get('socketio');
            if (io) {
                io.to(`game-${roomCode}`).emit("gameFinished", {
                    scores: room.players.map(p => ({
                        userId: p.userId,
                        username: p.username,
                        score: p.score,
                        answers: [0,1,2,3,4].map(qIndex => ({
                            questionIndex: qIndex,
                            isCorrect: p[`answered_q${qIndex}`]?.isCorrect || false
                        }))
                    }))
                });
            }
        }

        res.json(response);

    } catch (error) {
        console.error('Answer game error:', error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});

// REMOVED: /games/update-score endpoint
// REMOVED: /games/leaderboard endpoint

app.post('/games/invite/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;
        const fromUserId = req.user.userId;
        const fromUsername = req.user.username;

        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        await GameRoomModel.create({
            roomCode,
            players: [{
                userId: fromUserId,
                username: fromUsername,
                score: 0,
                isReady: false
            }],
            gameState: 'waiting'
        });

        await GameInviteModel.create({
            fromUserId,
            fromUsername,
            toUserId: userId,
            roomCode,
            status: 'pending'
        });

        res.json({
            roomCode,
            message: 'Invite sent'
        });
    } catch (error) {
        console.error('Send invite error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.get('/games/invites', authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const invites = await GameInviteModel.find({
            toUserId: userId,
            status: 'pending'
        }).sort({ createdAt: -1 });

        res.json(invites);
    } catch (error) {
        console.error('Get invites error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/games/invite/:inviteId/respond', authenticate, async (req, res) => {
    try {
        const { inviteId } = req.params;
        const { accept } = req.body;

        const invite = await GameInviteModel.findById(inviteId);

        if (!invite || invite.toUserId.toString() !== req.user.userId) {
            return res.status(404).json({ message: 'Invite not found' });
        }

        if (accept) {
            invite.status = 'accepted';
            await invite.save();

            const room = await GameRoomModel.findOne({ roomCode: invite.roomCode });
            if (room) {
                room.players.push({
                    userId: req.user.userId,
                    username: req.user.username,
                    score: 0,
                    isReady: true
                });
                await room.save();
            }

            res.json({
                roomCode: invite.roomCode,
                message: 'Invite accepted'
            });
        } else {
            invite.status = 'rejected';
            await invite.save();

            res.json({ message: 'Invite rejected' });
        }
    } catch (error) {
        console.error('Respond to invite error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/games/leave/:roomCode', authenticate, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const userId = req.user.userId;

        const room = await GameRoomModel.findOne({ roomCode });

        if (room) {
            room.players = room.players.filter(p => p.userId.toString() !== userId);

            if (room.players.length === 0) {
                await GameRoomModel.deleteOne({ roomCode });
            } else {
                await room.save();
            }
        }

        res.json({ message: 'Left room' });
    } catch (error) {
        console.error('Leave room error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.get('/games/room/:roomCode', authenticate, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const room = await GameRoomModel.findOne({ roomCode });

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        res.json(room);
    } catch (error) {
        console.error('Get room error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// ==================== NOTES & MOCKS ENDPOINTS ====================
app.get('/notes/urls', async (req, res) => {
    try {
        const datatosend = await noteslinks_model.find()
        res.json(datatosend)
    } catch (error) {
        console.error('Notes URLs error:', error);
        res.status(500).json({ message: "internal server error" })
    }
})

app.post('/notes', async (req, res) => {
    try {
        const data_towrite = req.body
        const document = await noteslinks_model.create(data_towrite)
        res.json({ message: "Note link created", document })
    } catch (error) {
        console.error('Create notes error:', error);
        res.status(500).json({ message: "internal server error" })
    }
})

app.get("/mocks/urls", async (req, res) => {
    try {
        const data_tosend = await mocklinks_model.find()
        res.json(data_tosend)
    } catch (error) {
        console.error('Mocks URLs error:', error);
        res.status(500).json({ message: "internal server error" })
    }
})

app.post('/mocks', async (req, res) => {
    try {
        const data_towrite = req.body
        const document = await mocklinks_model.create(data_towrite)
        res.json({ message: "Mock link created", document })
    } catch (error) {
        console.error('Create mocks error:', error);
        res.status(500).json({ message: "internal server error" })
    }
})

// ==================== UTILITY ENDPOINTS ====================
app.post('/refresh', async (req, res) => {
    try {
        const refreshtoken = req.cookies.refreshtoken;

        if (!refreshtoken) {
            return res.status(401).json({ message: "Refresh token not found" });
        }

        const decoded = jwt.verify(refreshtoken, REFRESH_TOKEN_SECRET);

        const tokenInDb = await refreshTokenModel.findOne({
            token: refreshtoken,
            userId: decoded.userId
        });

        if (!tokenInDb) {
            return res.status(403).json({ message: "Invalid refresh token" });
        }

        const user = await UserModel.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const accessToken = jwt.sign(
            { userId: user._id, username: user.Username },
            ACCESS_TOKEN_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );

        res.json({
            accesstoken: accessToken,
            user: {
                id: user._id,
                name: user.Name,
                username: user.Username
            }
        });

    } catch (err) {
        console.error('Refresh token error:', err);
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(403).json({ message: "Invalid or expired refresh token" });
        }

        res.status(500).json({ message: "Internal server error" });
    }
});

app.get('/test', (req, res) => {
    res.json({
        message: 'Server is running',
        cookies: req.cookies,
        headers: req.headers
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

// ==================== SOCKET.IO ====================
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: [
            'http://localhost:3000', 
            'http://127.0.0.1:3000', 
            'http://localhost:3001', 
            'http://localhost:5500', 
            'http://127.0.0.1:5500',
            'https://catalystt-frontend.netlify.app'
        ],
        credentials: true,
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"]
    }
});

// Make io available in routes
app.set('socketio', io);

io.use(socketAuthenticate);

io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.username} (${socket.id})`);

    socket.on("joinroom", (roomId) => {
        socket.join(roomId);
        console.log(`${socket.username} joined room: ${roomId}`);
    });

    socket.on("pvtmsg", async (data) => {
        try {
            const { roomId, msg } = data;

            io.to(roomId).emit("pvtmsg", {
                Sender: socket.username,
                messge: msg,
                userId: socket.userId,
                timestamp: new Date()
            });

            await savedChatModel.create({
                userId: socket.userId,
                roomId: roomId,
                username: socket.username,
                message: msg
            });

        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    socket.on("joinGameRoom", (roomCode) => {
        socket.join(`game-${roomCode}`);
        io.to(`game-${roomCode}`).emit("playerJoined", {
            username: socket.username,
            userId: socket.userId
        });
        console.log(`${socket.username} joined game room: ${roomCode}`);
    });

    socket.on("leaveGameRoom", (roomCode) => {
        socket.leave(`game-${roomCode}`);
        io.to(`game-${roomCode}`).emit("playerLeft", {
            username: socket.username,
            userId: socket.userId
        });
        console.log(`${socket.username} left game room: ${roomCode}`);
    });

    socket.on("gameReady", (roomCode) => {
        io.to(`game-${roomCode}`).emit("playerReady", {
            username: socket.username,
            userId: socket.userId
        });
        console.log(`${socket.username} is ready in room: ${roomCode}`);
    });

    socket.on("gameAnswer", (data) => {
        const { roomCode, answerIndex } = data;
        io.to(`game-${roomCode}`).emit("answerSubmitted", {
            username: socket.username,
            answerIndex,
            timestamp: new Date()
        });
        console.log(`${socket.username} answered in room: ${roomCode}`);
    });

    socket.on("gameMessage", (data) => {
        const { roomCode, message } = data;
        io.to(`game-${roomCode}`).emit("gameChat", {
            username: socket.username,
            message,
            timestamp: new Date()
        });
        console.log(`${socket.username} chatted in room: ${roomCode}`);
    });

    socket.on("sendGameInvite", async (data) => {
        const { toUserId, roomCode } = data;

        const invitedSocket = [...io.sockets.sockets.values()].find(s =>
            s.userId && s.userId.toString() === toUserId
        );

        if (invitedSocket) {
            invitedSocket.emit("gameInvite", {
                fromUserId: socket.userId,
                fromUsername: socket.username,
                roomCode,
                timestamp: new Date()
            });
            console.log(`${socket.username} invited ${toUserId} to room: ${roomCode}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ User disconnected: ${socket.username}`);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 CORS enabled for: https://catalystt-frontend.netlify.app`);
    console.log(`🔗 MongoDB Atlas connected`);
    console.log(`💬 Chats auto-delete in: 12 hours`);
    console.log(`🔐 Access Token Duration: ${ACCESS_TOKEN_EXPIRY}`);
});




