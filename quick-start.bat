@echo off
echo 🚀 EduAI Platform - Quick Start
echo ================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✓ Node.js version: %NODE_VERSION%
echo.

REM Install backend dependencies
echo 📦 Installing backend dependencies...
cd server
call npm install
if %errorlevel% equ 0 (
    echo ✓ Backend dependencies installed
) else (
    echo ❌ Failed to install backend dependencies
    pause
    exit /b 1
)

REM Seed database
echo.
echo 🌱 Seeding database...
call npm run seed || echo ⚠️  Database seeding skipped

REM Install frontend dependencies
echo.
echo 📦 Installing frontend dependencies...
cd ..\client
call npm install
if %errorlevel% equ 0 (
    echo ✓ Frontend dependencies installed
) else (
    echo ❌ Failed to install frontend dependencies
    pause
    exit /b 1
)

echo.
echo ================================
echo ✓ Setup Complete!
echo.
echo Next steps:
echo 1. Start MongoDB (if using local)
echo 2. Run backend: cd server && npm run dev
echo 3. Run frontend: cd client && npm start
echo.
echo Backend will run on: http://localhost:4000
echo Frontend will run on: http://localhost:5173
echo.
pause
