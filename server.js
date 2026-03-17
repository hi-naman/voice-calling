const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Tell Express to serve the static files in our 'public' folder
app.use(express.static('public'));

// Replace the old io.on block with this:
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Handle joining a room
    socket.on('join-room', (roomCode) => {
        socket.join(roomCode);
        console.log(`User ${socket.id} joined room: ${roomCode}`);
        
        // Let anyone else already in the room know that a new person arrived
        socket.to(roomCode).emit('user-joined', socket.id);
    });

    // 2. Relay WebRTC Signaling Data ONLY to the specific room
    // We will use these in the next step to connect the audio!
    socket.on('offer', (roomCode, offer) => {
        socket.to(roomCode).emit('offer', offer);
    });

    socket.on('answer', (roomCode, answer) => {
        socket.to(roomCode).emit('answer', answer);
    });

    socket.on('ice-candidate', (roomCode, candidate) => {
        socket.to(roomCode).emit('ice-candidate', candidate);
    });

    // Relay the hangup signal to the other user in the room
    socket.on('hangup', (roomCode) => {
        socket.to(roomCode).emit('hangup');
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
    });
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});