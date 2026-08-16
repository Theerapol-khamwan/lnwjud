@echo off
chcp 65001 >nul
title lnwjud Secure Tunnel
if exist "%~dp0start-lnwjud-tunnel.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-lnwjud-tunnel.ps1" -OpenDashboard
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\Downloads\tunnel\start-lnwjud-tunnel.ps1" -OpenDashboard
)
if errorlevel 1 pause
