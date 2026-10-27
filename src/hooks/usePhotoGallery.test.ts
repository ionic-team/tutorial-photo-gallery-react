import { Camera } from '@capacitor/camera';
import { Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { isPlatform } from '@ionic/react';
import type * as IonicReact from '@ionic/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserPhoto } from './usePhotoGallery';
import { usePhotoGallery } from './usePhotoGallery';

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: vi.fn() },
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Camera: 'CAMERA' },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { readFile: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn() },
  Directory: { Data: 'DATA' },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => `converted:${uri}` },
}));

vi.mock('@ionic/react', async (importOriginal) => ({
  ...(await importOriginal<typeof IonicReact>()),
  isPlatform: vi.fn(),
}));

const NOW = 1700000000000;

const setHybrid = (hybrid: boolean): void => {
  vi.mocked(isPlatform).mockImplementation((platform) => platform === 'hybrid' && hybrid);
};

// Renders the hook and waits for the saved photos to load.
const renderGallery = async (saved: UserPhoto[] | null) => {
  vi.mocked(Preferences.get).mockResolvedValue({ value: saved ? JSON.stringify(saved) : null });
  const hook = renderHook(() => usePhotoGallery());
  // Let the mocked storage and file reads resolve and the hook update.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(Preferences.get).toHaveBeenCalledWith({ key: 'photos' });
  return hook;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  setHybrid(false);
  vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: `file:///data/${NOW}.jpeg` });
  vi.mocked(Filesystem.readFile).mockImplementation(async ({ path }) => ({ data: `data-for-${path}` }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loading saved photos', () => {
  it('loads saved photos and reads each file as base64 on the web', async () => {
    const { result } = await renderGallery([{ filepath: 'a.jpeg' }, { filepath: 'b.jpeg' }]);

    await waitFor(() =>
      expect(result.current.photos).toEqual([
        { filepath: 'a.jpeg', webviewPath: 'data:image/jpeg;base64,data-for-a.jpeg' },
        { filepath: 'b.jpeg', webviewPath: 'data:image/jpeg;base64,data-for-b.jpeg' },
      ]),
    );
    expect(Filesystem.readFile).toHaveBeenCalledWith({ path: 'a.jpeg', directory: 'DATA' });
  });

  it('keeps the stored paths on native without reading the files', async () => {
    setHybrid(true);
    const saved = [{ filepath: 'file:///data/a.jpeg', webviewPath: 'converted:file:///data/a.jpeg' }];

    const { result } = await renderGallery(saved);

    await waitFor(() => expect(result.current.photos).toEqual(saved));
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it('starts with an empty gallery when nothing is saved', async () => {
    const { result } = await renderGallery(null);

    expect(result.current.photos).toEqual([]);
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });
});

describe('addNewToGallery', () => {
  it('saves a web photo and adds it to the front of the gallery', async () => {
    const { result } = await renderGallery([{ filepath: 'older.jpeg' }]);
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    vi.mocked(Camera.getPhoto).mockResolvedValue({ webPath: 'blob:new-photo', format: 'jpeg', saved: false });
    // Return the jsdom Blob directly: Node's Response would stringify it.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ blob: async () => new Blob(['image-bytes'], { type: 'image/jpeg' }) }),
    );

    await act(() => result.current.addNewToGallery());

    expect(Camera.getPhoto).toHaveBeenCalledWith({ resultType: 'uri', source: 'CAMERA', quality: 100 });
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: `${NOW}.jpeg`,
      data: `data:image/jpeg;base64,${btoa('image-bytes')}`,
      directory: 'DATA',
    });
    const expected = [
      { filepath: `${NOW}.jpeg`, webviewPath: 'blob:new-photo' },
      { filepath: 'older.jpeg', webviewPath: 'data:image/jpeg;base64,data-for-older.jpeg' },
    ];
    expect(result.current.photos).toEqual(expected);
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'photos', value: JSON.stringify(expected) });
  });

  it.each([
    ['the photo cannot be read', 'error' as const],
    ['the photo is not read as a data URL', new ArrayBuffer(1)],
  ])('does not save a web photo when %s', async (_, outcome) => {
    const { result } = await renderGallery(null);
    vi.mocked(Camera.getPhoto).mockResolvedValue({ webPath: 'blob:new-photo', format: 'jpeg', saved: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['image-bytes']) }));
    vi.stubGlobal(
      'FileReader',
      class {
        result: unknown = null;
        onerror: ((error: unknown) => void) | null = null;
        onload: (() => void) | null = null;

        readAsDataURL(): void {
          if (outcome === 'error') {
            this.onerror?.(new Error('read failed'));
          } else {
            this.result = outcome;
            this.onload?.();
          }
        }
      },
    );

    await expect(act(() => result.current.addNewToGallery())).rejects.toBeDefined();

    expect(Filesystem.writeFile).not.toHaveBeenCalled();
    expect(result.current.photos).toEqual([]);
    expect(Preferences.set).not.toHaveBeenCalled();
  });

  it('reads a native photo from its file path and converts the saved URI', async () => {
    setHybrid(true);
    const { result } = await renderGallery(null);
    vi.mocked(Camera.getPhoto).mockResolvedValue({
      path: 'file:///tmp/photo.jpeg',
      webPath: 'capacitor://localhost/_capacitor_file_/tmp/photo.jpeg',
      format: 'jpeg',
      saved: false,
    });
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: 'BASE64DATA' });

    await act(() => result.current.addNewToGallery());

    expect(Filesystem.readFile).toHaveBeenCalledWith({ path: 'file:///tmp/photo.jpeg' });
    expect(Filesystem.writeFile).toHaveBeenCalledWith({ path: `${NOW}.jpeg`, data: 'BASE64DATA', directory: 'DATA' });
    expect(result.current.photos).toEqual([
      { filepath: `file:///data/${NOW}.jpeg`, webviewPath: `converted:file:///data/${NOW}.jpeg` },
    ]);
  });

  it('passes native file data returned as a Blob through to the filesystem unchanged', async () => {
    setHybrid(true);
    const { result } = await renderGallery(null);
    vi.mocked(Camera.getPhoto).mockResolvedValue({ path: 'file:///tmp/photo.jpeg', format: 'jpeg', saved: false });
    const data = new Blob(['BLOBDATA']);
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data });

    await act(() => result.current.addNewToGallery());

    expect(vi.mocked(Filesystem.writeFile).mock.calls[0][0].data).toBe(data);
  });
});

describe('deletePhoto', () => {
  it('removes the photo from the gallery, storage, and filesystem', async () => {
    setHybrid(true);
    const saved = [
      { filepath: 'file:///data/a.jpeg' },
      { filepath: 'file:///data/b.jpeg' },
      { filepath: 'file:///data/c.jpeg' },
    ];
    const { result } = await renderGallery(saved);
    await waitFor(() => expect(result.current.photos).toHaveLength(3));

    await act(() => result.current.deletePhoto(saved[1]));

    expect(result.current.photos).toEqual([saved[0], saved[2]]);
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'photos', value: JSON.stringify([saved[0], saved[2]]) });
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({ path: 'b.jpeg', directory: 'DATA' });
  });
});
