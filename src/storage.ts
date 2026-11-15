import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { config } from "./config";

const {
  endpoint,
  bucket,
  accessKeyId,
  secretAccessKey,
  publicBaseUrl,
  prefix,
} = config.storage;

const client =
  endpoint && accessKeyId && secretAccessKey
    ? new S3Client({
        endpoint,
        region: "auto",
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      })
    : undefined;

export const imageTypes = ["image/jpeg", "image/png", "image/webp"];

export function imageExtension(image: Buffer, type: string) {
  if (
    type === "image/jpeg" &&
    image.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  )
    return "jpg";
  if (
    type === "image/png" &&
    image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    type === "image/webp" &&
    image.length >= 12 &&
    image.toString("ascii", 0, 4) === "RIFF" &&
    image.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
}

export async function uploadImage(
  body: Buffer,
  contentType: string,
  extension: string,
) {
  if (!client || !bucket || !publicBaseUrl) return;
  const key = `${prefix}/${randomUUID()}.${extension}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
