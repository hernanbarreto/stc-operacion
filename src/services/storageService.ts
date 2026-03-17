import { ref, listAll, uploadBytes, getMetadata, getBlob } from 'firebase/storage';
import { storage } from '../firebase';

export interface StorageFile {
    name: string;
    fullPath: string;
    size: number;
    updated: string;
}

/** List all Excel files in root of storage */
export async function listExcelFiles(): Promise<StorageFile[]> {
    const dirRef = ref(storage, '/');
    const result = await listAll(dirRef);

    const files: StorageFile[] = [];
    for (const item of result.items) {
        if (!item.name.endsWith('.xlsx') && !item.name.endsWith('.xls')) continue;
        try {
            const meta = await getMetadata(item);
            files.push({
                name: item.name,
                fullPath: item.fullPath,
                size: meta.size,
                updated: meta.updated,
            });
        } catch {
            files.push({ name: item.name, fullPath: item.fullPath, size: 0, updated: '' });
        }
    }

    return files.sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Check if a file with the given name already exists */
export async function fileExists(name: string): Promise<boolean> {
    const fileRef = ref(storage, name);
    try {
        await getMetadata(fileRef);
        return true;
    } catch {
        return false;
    }
}

/** Upload file to storage root */
export async function uploadExcelFile(file: File, name?: string): Promise<void> {
    const fileName = name || file.name;
    const fileRef = ref(storage, fileName);
    await uploadBytes(fileRef, file);
}

/** Download file as ArrayBuffer using getBlob (browser-optimized) */
export async function downloadExcelFile(path: string): Promise<ArrayBuffer> {
    const fileRef = ref(storage, path);
    const blob = await getBlob(fileRef);
    return blob.arrayBuffer();
}
