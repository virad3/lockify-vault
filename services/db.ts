import { collection, doc, getDocs, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { EncryptedVaultItem } from '../types';

// Database Interface
interface DBService {
  saveItem: (item: EncryptedVaultItem) => Promise<void>;
  getItems: (uid: string) => Promise<EncryptedVaultItem[]>;
  deleteItem: (id: string) => Promise<void>;
}

class FirestoreDB implements DBService {
  private collectionName = 'vault_items';

  async saveItem(item: EncryptedVaultItem): Promise<void> {
    try {
      const itemRef = doc(db, this.collectionName, item.id);
      await setDoc(itemRef, item);
    } catch (error) {
      console.error("Error saving item to Firestore:", error);
      throw error;
    }
  }

  async getItems(uid: string): Promise<EncryptedVaultItem[]> {
    try {
      const q = query(
        collection(db, this.collectionName), 
        where("ownerId", "==", uid)
      );
      
      const querySnapshot = await getDocs(q);
      const items: EncryptedVaultItem[] = [];
      querySnapshot.forEach((doc) => {
        items.push(doc.data() as EncryptedVaultItem);
      });
      return items;
    } catch (error) {
      console.error("Error fetching items from Firestore:", error);
      throw error;
    }
  }

  async deleteItem(id: string): Promise<void> {
    try {
      await deleteDoc(doc(db, this.collectionName, id));
    } catch (error) {
      console.error("Error deleting item from Firestore:", error);
      throw error;
    }
  }
}

// Export a singleton
export const dbService = new FirestoreDB();
// Exporting as 'db' to match previous import usage in App.tsx, 
// though we renamed the class to FirestoreDB for clarity.
export { dbService as db };