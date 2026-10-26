@echo off
cd /d "%~dp0"
set "INSTALLED_APP="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\OpenQuestionStudio" /v "ApplicationPath" 2^>nul') do set "INSTALLED_APP=%%B"
if defined INSTALLED_APP if exist "%INSTALLED_APP%" (
  start "" "%INSTALLED_APP%"
  exit /b 0
)
set "APP_EXE=%~dp0release\OpenQuestionStudio-0.3.0.exe"
if exist "%APP_EXE%" (
  start "" "%APP_EXE%"
  exit /b 0
)
call npm start
