@echo off
rem Planlayici kurulumu (bir kez): panelin GraphWalker stratejisi icin native messaging host.
rem Ayrinti: runner\README.md > Planlayici. Kaldirmak icin: install-planner.cmd --uninstall
where node >nul 2>nul || (
  echo Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar deneyin.
  pause
  exit /b 1
)
node "%~dp0planner\install.js" %*
pause
