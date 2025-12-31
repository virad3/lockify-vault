export enum ItemType {
  LOGIN = 'LOGIN',
  NOTE = 'NOTE',
  CARD = 'CARD',
  KEY = 'KEY'
}

export interface VaultItem {
  id: string;
  type: ItemType;
  title: string;
  username?: string;
  password?: string; // Encrypted in transit/storage, decrypted in state
  url?: string;
  notes?: string;
  folder?: string;
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
}

// Representing the encrypted version stored in DB
export interface EncryptedVaultItem {
  id: string;
  data: string; // JSON string of VaultItem encrypted
  iv: string;   // Initialization Vector
  salt: string; // Salt used for key derivation (if per-item)
  ownerId: string;
  updatedAt: number;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}
