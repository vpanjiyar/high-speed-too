import { openDB, type IDBPDatabase } from 'idb';
import type { Network } from '../types';

const DB_NAME = 'high-speed-too';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function saveNetwork(network: Network, key = 'autosave'): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, JSON.parse(JSON.stringify(network)), key);
}

export async function loadNetwork(key = 'autosave'): Promise<Network | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, key) as Promise<Network | undefined>;
}

export function exportNetworkToFile(network: Network): void {
  const json = JSON.stringify(network, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `high-speed-too-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importNetworkFromFile(): Promise<Network> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result as string) as Network);
        } catch {
          reject(new Error('Invalid JSON file'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
