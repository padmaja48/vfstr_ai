#!/bin/bash

echo "🚀 EduAI Platform - Quick Start"
echo "================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo ""

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd server
npm install
if [ $? -eq 0 ]; then
    echo "✓ Backend dependencies installed"
else
    echo "❌ Failed to install backend dependencies"
    exit 1
fi

# Seed database
echo ""
echo "🌱 Seeding database..."
npm run seed || echo "⚠️  Database seeding skipped (make sure MongoDB is running)"

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd ../client
npm install
if [ $? -eq 0 ]; then
    echo "✓ Frontend dependencies installed"
else
    echo "❌ Failed to install frontend dependencies"
    exit 1
fi

echo ""
echo "================================"
echo "✓ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Start MongoDB (if using local)"
echo "2. Run backend: cd server && npm run dev"
echo "3. Run frontend: cd client && npm start"
echo ""
echo "Backend will run on: http://localhost:4000"
echo "Frontend will run on: http://localhost:5173"
echo ""
