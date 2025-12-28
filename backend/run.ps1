Set-Location -Path $PSScriptRoot

$Py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

& $Py -m uvicorn app.main:app --reload --port 8000
