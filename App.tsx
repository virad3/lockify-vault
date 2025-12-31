import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Shield, Lock, Search, Plus, LogOut, Copy, Eye, EyeOff, 
  Trash2, Folder, Key, StickyNote, CreditCard, Menu, X,
  Check, RefreshCw, Sun, Moon, AlertTriangle
} from 'lucide-react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { auth } from './services/firebase';

import { UserProfile, VaultItem, ItemType, EncryptedVaultItem } from './types';
import { deriveKey, encryptData, decryptData, generateSalt, stringToSalt, bufferToBase64 } from './utils/crypto';
import { db } from './services/db';
import { Button, Input, Modal, Badge } from './components/UIComponents';

// --- Toast System ---
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

// --- Main App ---
export default function App() {
  // Auth State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoginView, setIsLoginView] = useState(true); // Login vs Signup

  // Encryption State
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [isVaultLocked, setIsVaultLocked] = useState(true);
  
  // Data State
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<ItemType | 'ALL'>('ALL');
  
  // UI State
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [darkMode, setDarkMode] = useState(true);

  // Theme Init
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // --- Auth Integration ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User'
        });
      } else {
        setUser(null);
        setMasterKey(null);
        setIsVaultLocked(true);
        setItems([]);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleAuth = async (e: React.FormEvent, email: string, password: string) => {
    e.preventDefault();
    setAuthLoading(true);
    
    try {
      if (isLoginView) {
        await signInWithEmailAndPassword(auth, email, password);
        showToast("Welcome back!");
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        showToast("Account created successfully!");
      }
      // onAuthStateChanged will handle the state update
    } catch (err: any) {
      console.error(err);
      let msg = "Authentication failed";
      if (err.code === 'auth/invalid-credential') msg = "Invalid email or password";
      if (err.code === 'auth/email-already-in-use') msg = "Email already in use";
      if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters";
      showToast(msg, 'error');
      setAuthLoading(false); // Only manual reset needed on error
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showToast("Logged out successfully");
    } catch (error) {
      showToast("Error logging out", "error");
    }
  };

  // --- Vault Unlock / Master Password ---
  const unlockVault = async (password: string) => {
    try {
      // In a real app, we would verify the password hash against the server or a stored hash.
      // Here, we derive the key. If the key successfully decrypts items, it's correct.
      // For this demo, we just generate a deterministic salt based on the UID for stability 
      // (in production, salt should be random per user and stored in Firestore user profile).
      
      if (!user) return;
      
      const deterministicSalt = stringToSalt(window.btoa(user.uid + "_salt_fixed_123").substring(0, 24)); // Mock salt
      const key = await deriveKey(password, deterministicSalt);
      setMasterKey(key);
      setIsVaultLocked(false);
      loadVaultItems(user.uid, key);
    } catch (err) {
      console.error(err);
      showToast("Failed to unlock vault", "error");
    }
  };

  const loadVaultItems = async (uid: string, key: CryptoKey) => {
    setLoadingItems(true);
    try {
      const encryptedItems = await db.getItems(uid);
      const decryptedItems: VaultItem[] = [];

      for (const encItem of encryptedItems) {
        try {
          const data = await decryptData(encItem.data, encItem.iv, key);
          decryptedItems.push({ ...data, id: encItem.id });
        } catch (e) {
          console.error("Failed to decrypt item", encItem.id);
          // showToast(`Could not decrypt item ${encItem.id}`, 'error');
        }
      }
      setItems(decryptedItems.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (e) {
      console.error(e);
      showToast("Error loading vault from cloud", "error");
    } finally {
      setLoadingItems(false);
    }
  };

  // --- CRUD Operations ---
  const handleSaveItem = async (item: Partial<VaultItem>) => {
    if (!user || !masterKey) return;
    
    const newItem: VaultItem = {
      id: item.id || crypto.randomUUID(),
      type: item.type || ItemType.LOGIN,
      title: item.title || 'Untitled',
      username: item.username || '',
      password: item.password || '',
      url: item.url || '',
      notes: item.notes || '',
      folder: item.folder || '',
      favorite: item.favorite || false,
      createdAt: item.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    try {
      // Encrypt
      const { cipherText, iv } = await encryptData(newItem, masterKey);
      
      // Store
      const encryptedItem: EncryptedVaultItem = {
        id: newItem.id,
        data: cipherText,
        iv: iv,
        salt: '', // Unused in this simple implementation
        ownerId: user.uid,
        updatedAt: newItem.updatedAt
      };

      await db.saveItem(encryptedItem);
      
      // Update State
      setItems(prev => {
        const idx = prev.findIndex(i => i.id === newItem.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = newItem;
          return copy;
        }
        return [newItem, ...prev];
      });
      
      setIsModalOpen(false);
      setEditingItem(null);
      showToast("Item saved securely");
    } catch (e) {
      console.error(e);
      showToast("Failed to save item", "error");
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (confirm('Are you sure you want to delete this item?')) {
      try {
        await db.deleteItem(id);
        setItems(prev => prev.filter(i => i.id !== id));
        showToast("Item deleted");
      } catch (e) {
        showToast("Failed to delete item", "error");
      }
    }
  };

  // --- Views ---

  if (!user && !authLoading) {
    return <AuthScreen isLogin={isLoginView} onToggle={() => setIsLoginView(!isLoginView)} onSubmit={handleAuth} isLoading={authLoading} />;
  }
  
  if (authLoading && !user) {
      return (
          <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
             <RefreshCw className="w-8 h-8 animate-spin text-primary-600" />
          </div>
      );
  }

  if (isVaultLocked) {
    return <UnlockScreen onUnlock={unlockVault} onLogout={handleLogout} />;
  }

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.username?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'ALL' || item.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300">
      
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[100] space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center p-4 rounded-lg shadow-lg border-l-4 ${t.type === 'success' ? 'bg-white dark:bg-slate-800 border-green-500' : 'bg-white dark:bg-slate-800 border-red-500'} animate-in slide-in-from-right`}>
            {t.type === 'success' ? <Check className="w-5 h-5 text-green-500 mr-3" /> : <AlertTriangle className="w-5 h-5 text-red-500 mr-3" />}
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-200 ease-in-out bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col`}>
        <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center group cursor-default">
            <div className="relative mr-3">
               <div className="absolute inset-0 bg-primary-500 blur-lg opacity-20 rounded-full group-hover:opacity-40 transition-opacity"></div>
               <Lock className="w-7 h-7 text-primary-600 dark:text-primary-500 relative z-10" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-indigo-600 dark:from-primary-400 dark:to-indigo-400">Lockify</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <SidebarItem icon={Lock} label="All Items" active={filterType === 'ALL'} onClick={() => setFilterType('ALL')} />
          <SidebarItem icon={Key} label="Logins" active={filterType === ItemType.LOGIN} onClick={() => setFilterType(ItemType.LOGIN)} />
          <SidebarItem icon={CreditCard} label="Cards" active={filterType === ItemType.CARD} onClick={() => setFilterType(ItemType.CARD)} />
          <SidebarItem icon={StickyNote} label="Secure Notes" active={filterType === ItemType.NOTE} onClick={() => setFilterType(ItemType.NOTE)} />
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
           <button 
            onClick={() => setDarkMode(!darkMode)}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {darkMode ? <Sun className="w-5 h-5 mr-3" /> : <Moon className="w-5 h-5 mr-3" />}
            {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button 
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-4 lg:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 backdrop-blur-sm z-10">
          <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex-1 max-w-xl mx-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search vault..." 
                className="w-full pl-10 pr-4 py-2 text-sm bg-slate-100 dark:bg-slate-800 border-none rounded-full focus:ring-2 focus:ring-primary-500 placeholder-slate-500 dark:text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={() => { setEditingItem(null); setIsModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New Item
          </Button>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          {loadingItems ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <RefreshCw className="w-8 h-8 animate-spin mb-4" />
              <p>Syncing vault...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-slate-400">
              <div className="bg-slate-100 dark:bg-slate-800/50 p-6 rounded-full mb-4">
                 <Lock className="w-12 h-12 text-slate-400" />
              </div>
              <p className="text-lg font-medium">No items found</p>
              <p className="text-sm">Create a new secure item to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredItems.map(item => (
                <VaultCard 
                  key={item.id} 
                  item={item} 
                  onEdit={() => { setEditingItem(item); setIsModalOpen(true); }}
                  onDelete={() => handleDeleteItem(item.id)}
                  onCopy={(val) => {
                     navigator.clipboard.writeText(val);
                     showToast("Copied to clipboard");
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Add/Edit Modal */}
      <ItemModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        initialData={editingItem}
        onSave={handleSaveItem}
      />
    </div>
  );
}

// --- Sub Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 group ${active ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
  >
    <Icon className={`w-5 h-5 mr-3 transition-colors ${active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
    {label}
  </button>
);

const AuthScreen = ({ isLogin, onToggle, onSubmit, isLoading }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8">
        <div className="flex justify-center mb-8">
          <div className="p-4 bg-gradient-to-br from-primary-50 to-indigo-50 dark:from-primary-900/30 dark:to-indigo-900/30 rounded-2xl shadow-inner">
            <Lock className="w-12 h-12 text-primary-600 dark:text-primary-500" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-slate-900 dark:text-white mb-2">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p className="text-center text-slate-500 dark:text-slate-400 mb-8">
          {isLogin ? 'Enter your email and password to continue.' : 'Setup your secure digital vault account.'}
        </p>

        <form onSubmit={(e) => onSubmit(e, email, password)} className="space-y-4">
          <Input 
            label="Email" 
            type="email" 
            placeholder="name@example.com" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            required 
          />
          <Input 
            label="Account Password" 
            type="password" 
            placeholder="••••••••" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
          />
          <Button type="submit" className="w-full" isLoading={isLoading}>
            {isLogin ? 'Login' : 'Create Account'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button onClick={onToggle} className="text-primary-600 hover:text-primary-500 font-medium">
            {isLogin ? 'Create one' : 'Login'}
          </button>
        </div>
        
        <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
            <p className="text-xs text-slate-400">
                <Lock className="inline w-3 h-3 mr-1" />
                End-to-End Encrypted. We cannot see your data.
            </p>
        </div>
      </div>
    </div>
  );
};

const UnlockScreen = ({ onUnlock, onLogout }: any) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onUnlock(password);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-20 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary-600 blur-[120px]"></div>
      </div>

      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 z-10 shadow-2xl">
        <div className="text-center mb-8">
          <Lock className="w-12 h-12 text-primary-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white">Security Check</h2>
          <p className="text-slate-400 mt-2">Please enter your Master Password to decrypt your vault.</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input 
            type="password" 
            placeholder="Master Password" 
            className="bg-slate-900/50 border-slate-700 text-white placeholder-slate-500 focus:ring-primary-500"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          <Button type="submit" className="w-full py-3 text-lg" isLoading={loading}>
            Decrypt Vault
          </Button>
        </form>

        <button onClick={onLogout} className="w-full mt-4 text-sm text-slate-500 hover:text-slate-300">
          Not you? Logout
        </button>
      </div>
    </div>
  );
};

const VaultCard = ({ item, onEdit, onDelete, onCopy }: { item: VaultItem, onEdit: () => void, onDelete: () => void, onCopy: (val: string) => void }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-lg hover:border-primary-500/50 dark:hover:border-primary-500/50 transition-all duration-300 p-5 flex flex-col relative overflow-hidden">
       {/* Card Decoration */}
       <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-bl-3xl -mr-4 -mt-4 z-0"></div>

       <div className="flex items-start justify-between mb-4 z-10">
         <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-lg ${
                item.type === ItemType.LOGIN ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' :
                item.type === ItemType.CARD ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' :
                'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
            }`}>
                {item.type === ItemType.LOGIN ? <Lock className="w-5 h-5" /> :
                 item.type === ItemType.CARD ? <CreditCard className="w-5 h-5" /> :
                 <StickyNote className="w-5 h-5" />}
            </div>
            <div>
                <h3 className="font-semibold text-slate-900 dark:text-white truncate max-w-[150px]">{item.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.username || 'No username'}</p>
            </div>
         </div>
       </div>

       {item.password && (
         <div className="mb-4 bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 flex items-center justify-between border border-slate-100 dark:border-slate-800/50">
            <code className="text-sm font-mono text-slate-700 dark:text-slate-300 truncate max-w-[160px]">
                {showPassword ? item.password : '••••••••••••'}
            </code>
            <div className="flex space-x-1">
                <button 
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500"
                >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button 
                  onClick={() => onCopy(item.password || '')}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500"
                >
                    <Copy className="w-4 h-4" />
                </button>
            </div>
         </div>
       )}

       <div className="mt-auto flex justify-end space-x-2 pt-4 border-t border-slate-100 dark:border-slate-800/50 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={onEdit}>Edit</Button>
          <Button variant="ghost" className="h-8 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={onDelete}>
              <Trash2 className="w-4 h-4" />
          </Button>
       </div>
    </div>
  );
};

// --- Form Component ---
const ItemModal = ({ isOpen, onClose, initialData, onSave }: any) => {
  const [formData, setFormData] = useState<Partial<VaultItem>>({
    type: ItemType.LOGIN,
    title: '',
    username: '',
    password: '',
    url: '',
    notes: ''
  });
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData({ type: ItemType.LOGIN, title: '', username: '', password: '', url: '', notes: '' });
    }
  }, [initialData, isOpen]);

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let pass = "";
    for(let i=0; i<16; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData({...formData, password: pass});
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initialData ? 'Edit Item' : 'New Secure Item'}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="space-y-4">
        
        <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Type</label>
                <select 
                    className="w-full h-10 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 focus:ring-2 focus:ring-primary-500"
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value as ItemType})}
                >
                    <option value={ItemType.LOGIN}>Login</option>
                    <option value={ItemType.CARD}>Card</option>
                    <option value={ItemType.NOTE}>Note</option>
                </select>
             </div>
             <Input 
                label="Title" 
                placeholder="e.g. Google" 
                value={formData.title} 
                onChange={e => setFormData({...formData, title: e.target.value})}
                required 
             />
        </div>

        <Input 
            label={formData.type === ItemType.CARD ? "Cardholder Name" : "Username / Email"}
            value={formData.username} 
            onChange={e => setFormData({...formData, username: e.target.value})}
        />

        <div className="relative">
            <Input 
                label={formData.type === ItemType.CARD ? "Card Number" : "Password"}
                type={showPass ? "text" : "password"}
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
            />
            <div className="absolute right-0 top-6 flex items-center pr-1">
                 <button type="button" onClick={generatePassword} className="p-1.5 text-slate-400 hover:text-primary-500" title="Generate">
                    <RefreshCw className="w-4 h-4" />
                 </button>
                 <button type="button" onClick={() => setShowPass(!showPass)} className="p-1.5 text-slate-400 hover:text-slate-600">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                 </button>
            </div>
        </div>

        {formData.type === ItemType.LOGIN && (
             <Input 
                label="Website URL"
                placeholder="https://"
                value={formData.url}
                onChange={e => setFormData({...formData, url: e.target.value})}
            />
        )}

        <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Notes</label>
            <textarea 
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 h-20 focus:ring-2 focus:ring-primary-500"
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
            />
        </div>

        <div className="pt-4 flex justify-end space-x-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save Securely</Button>
        </div>
      </form>
    </Modal>
  );
};