@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  Sube C:\Users\jaman\Documents\PROYECTOS\INV3D a
rem  https://github.com/jamanteiga/INV3D (rama main)
rem  - Incluye subcarpetas.
rem  - Los ficheros locales sobrescriben a los del repositorio.
rem  - Lo que solo existe en GitHub (p. ej. DOCUMENTACION, .github) se conserva.
rem ============================================================
set "CARPETA=C:\Users\jaman\Documents\PROYECTOS\INV3D"
set "REPO=https://github.com/jamanteiga/INV3D.git"

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git no esta instalado. Descargalo de https://git-scm.com/download/win y vuelve a ejecutar.
  pause & exit /b 1
)

cd /d "%CARPETA%" || (echo [ERROR] No existe %CARPETA% & pause & exit /b 1)

rem --- Ficheros que nunca se suben (dependencias y compilados) ---
if not exist ".gitignore" (
  > .gitignore echo node_modules/
  >> .gitignore echo dist/
  >> .gitignore echo public/oc/
  >> .gitignore echo public/dwg/
  >> .gitignore echo *.log
)

rem --- Preparar el repositorio local ---
if not exist ".git" git init -q
git config user.name >nul 2>nul || git config user.name "jamanteiga"
git config user.email >nul 2>nul || git config user.email "jamanteiga@users.noreply.github.com"
git remote remove origin >nul 2>nul
git remote add origin %REPO%

echo Descargando el estado actual de GitHub...
git fetch origin main
if errorlevel 1 (
  echo [ERROR] No se pudo conectar con GitHub. Revisa la conexion o el inicio de sesion.
  pause & exit /b 1
)

rem Se toma el historial de GitHub sin tocar tus ficheros locales
git reset -q --mixed origin/main
git checkout -q -B main

rem Anade y sobrescribe todo lo local (subcarpetas incluidas) sin borrar lo que solo esta en GitHub
git add --ignore-removal .
git diff --cached --quiet
if not errorlevel 1 (
  echo No hay cambios que subir.
  pause & exit /b 0
)
git commit -q -m "Actualizacion INV3D %date% %time%"

echo Subiendo a GitHub...
git push -u origin main
if errorlevel 1 (
  echo [ERROR] La subida ha fallado. Si pide credenciales, inicia sesion en la ventana de GitHub que se abre.
  pause & exit /b 1
)

echo.
echo Hecho. GitHub Pages se actualizara en unos 2 minutos:
echo https://jamanteiga.github.io/INV3D/
pause