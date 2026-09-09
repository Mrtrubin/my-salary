// 密码类修改申请的对称加解密工具（AES-GCM）。
// 待审核期间新密码必须可还原（审核通过后写入 Auth），故用服务端密钥加密存储，绝不明文落库。
// 密钥来源：Edge Function 环境变量 CHANGE_REQUEST_SECRET（任意长度字符串，经 SHA-256 派生 256 位密钥）。

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** 加密明文，返回 `ivBase64:cipherBase64`。 */
export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain));
  return `${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

/** 解密 `ivBase64:cipherBase64`，还原明文。 */
export async function decryptSecret(payload: string, secret: string): Promise<string> {
  const [ivPart, cipherPart] = payload.split(":");
  if (!ivPart || !cipherPart) throw new Error("密文格式不正确");
  const key = await deriveKey(secret);
  const iv = fromBase64(ivPart);
  const cipher = fromBase64(cipherPart);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return decoder.decode(plain);
}