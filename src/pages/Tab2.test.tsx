import type { ActionSheetButton } from '@ionic/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { close, trash } from 'ionicons/icons';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserPhoto } from '../hooks/usePhotoGallery';

import Tab2 from './Tab2';

const gallery = vi.hoisted(() => ({
  photos: [] as UserPhoto[],
  addNewToGallery: vi.fn(),
  deletePhoto: vi.fn(),
}));

vi.mock('../hooks/usePhotoGallery', () => ({
  usePhotoGallery: () => gallery,
}));

const photos: UserPhoto[] = [
  { filepath: 'a.jpeg', webviewPath: 'data:image/jpeg;base64,AAA' },
  { filepath: 'b.jpeg', webviewPath: 'data:image/jpeg;base64,BBB' },
];

const actionSheet = () => document.querySelector('ion-action-sheet') as HTMLIonActionSheetElement;

describe('Tab2', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gallery.photos = photos;
  });

  it('shows a thumbnail for each photo', () => {
    render(<Tab2 />);

    expect(screen.getByAltText('Photo 1')).toHaveAttribute('src', photos[0].webviewPath);
    expect(screen.getByAltText('Photo 2')).toHaveAttribute('src', photos[1].webviewPath);
  });

  it('takes a photo when the camera button is tapped', () => {
    const { container } = render(<Tab2 />);

    fireEvent.click(container.querySelector('ion-fab-button') as Element);

    expect(gallery.addNewToGallery).toHaveBeenCalledTimes(1);
  });

  it('opens the photo actions when a photo is tapped', async () => {
    render(<Tab2 />);
    expect(actionSheet().isOpen).toBe(false);

    fireEvent.click(screen.getByAltText('Photo 2'));

    await waitFor(() => expect(actionSheet().isOpen).toBe(true));
    expect(actionSheet().buttons).toEqual([
      expect.objectContaining({ text: 'Delete', role: 'destructive', icon: trash }),
      expect.objectContaining({ text: 'Cancel', role: 'cancel', icon: close }),
    ]);
  });

  it('deletes the tapped photo when Delete is chosen', async () => {
    render(<Tab2 />);
    fireEvent.click(screen.getByAltText('Photo 2'));
    await waitFor(() => expect(actionSheet().isOpen).toBe(true));

    const deleteButton = (actionSheet().buttons as ActionSheetButton[]).find((button) => button.text === 'Delete');
    expect(deleteButton?.handler).toBeTypeOf('function');
    act(() => {
      deleteButton?.handler?.();
    });

    expect(gallery.deletePhoto).toHaveBeenCalledWith(photos[1]);
    await waitFor(() => expect(actionSheet().isOpen).toBe(false));
  });
});
