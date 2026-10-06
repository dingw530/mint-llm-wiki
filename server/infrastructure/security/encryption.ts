import crypto from 'crypto';

// AES-256-GCM 认证加密算法，提供机密性 + 完整性保护
const ALGORITHM = 'aes-256-gcm';

// 通过 scrypt 密钥派生函数将用户提供的密钥转换为 32 字节 AES 密钥
function getKey(): Buffer {
  const key = process.env.AI_CHAT_ENCRYPTION_KEY;
  if (!key) {
    console.error('AI_CHAT_ENCRYPTION_KEY environment variable is required');
    process.exit(1);
  }
  return crypto.scryptSync(key, 'ai-chat-salt', 32);
}

// 加密：输出格式为 "iv:authTag:ciphertext"（均为 hex 编码）
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16); // 每次加密生成随机 IV
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex'); // GCM 认证标签，防篡改
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

// 解密：解析 "iv:authTag:ciphertext" 格式，校验完整性后还原明文
export function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// 脱敏显示：只保留前 3 位和末位，中间用 **** 代替
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 6) return '****';
  return apiKey.slice(0, 3) + '****' + apiKey.slice(-1);
}
