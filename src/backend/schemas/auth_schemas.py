from pydantic import BaseModel, EmailStr


class AdminRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    secret_key: str


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
