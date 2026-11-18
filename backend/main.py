import logging
from importlib.util import find_spec
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from .commands import execute, ConfirmationRequired, SAMPLES
from .launcher import ActionError
from .settings import Settings, SettingsStore
from .speech import transcribe, MAX_AUDIO
from .tts import capabilities

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nova")
app = FastAPI(title="NOVA Local Assistant")
ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ORIGINS),
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)
store = SettingsStore()


@app.middleware("http")
async def local_only(request: Request, call_next):
    if request.headers.get("host", "").split(":")[0] not in {
        "127.0.0.1",
        "localhost",
        "testserver",
    }:
        return JSONResponse({"detail": "Local hosts only."}, status_code=403)
    if request.method in {"POST", "PUT"} and request.headers.get(
        "origin"
    ) not in ORIGINS | {None}:
        return JSONResponse({"detail": "Untrusted origin."}, status_code=403)
    return await call_next(request)


@app.exception_handler(ActionError)
async def action_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(Exception)
async def unexpected(request, exc):
    log.exception("Request failed", exc_info=exc)
    return JSONResponse(
        {"detail": "Unexpected backend error. Check terminal logs."}, status_code=500
    )


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str = Field(min_length=1, max_length=1000, pattern=r"\S")
    confirmed: bool = False


@app.get("/api/health")
def health():
    return {
        "status": "ready",
        "name": "NOVA",
        "audio": "browser-wav",
        "execution_host": "backend computer",
        "capabilities": {"transcription": find_spec("speech_recognition") is not None},
    }


@app.get("/api/commands")
def commands():
    return {"commands": SAMPLES + ["open safari"]}


@app.post("/api/command")
def command(body: Command):
    try:
        return execute(body.text, body.confirmed)
    except ConfirmationRequired as exc:
        return {
            "status": "confirmation_required",
            "message": str(exc),
            "ended": False,
            "action": None,
        }


@app.get("/api/settings")
def get_settings():
    return store.get()


@app.put("/api/settings")
def save_settings(settings: Settings):
    return store.save(settings)


@app.get("/api/voices")
def voices():
    return capabilities()


@app.post("/api/transcribe")
async def audio(request: Request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_AUDIO:
            raise HTTPException(413, "Recording exceeds 4 MB.")
    return {"text": await run_in_threadpool(transcribe, bytes(data))}
