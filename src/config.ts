import dotenv from "dotenv";
dotenv.config();
if (
  !process.env.DATABASE_URL ||
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET.length < 32
)
  throw new Error(
    "Set DATABASE_URL and JWT_SECRET (minimum 32 characters) in .env",
  );
export const config = {
  port: Number(process.env.PORT || 8080),
  secret: process.env.JWT_SECRET,
  expires: process.env.JWT_EXPIRES_IN || "8h",
  storage: {
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    bucket: process.env.OBJECT_STORAGE_BUCKET,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    publicBaseUrl: process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.replace(
      /\/+$/,
      "",
    ),
    prefix:
      process.env.OBJECT_STORAGE_PREFIX?.replace(/^\/+|\/+$/g, "") ||
      "products",
  },
  cors: (
    process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim()),
};
