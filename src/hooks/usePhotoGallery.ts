import { useState, useEffect } from "react";
import { useCamera } from '@ionic/react-hooks/camera';
import { useFilesystem, base64FromPath } from '@ionic/react-hooks/filesystem';
import { useStorage } from '@ionic/react-hooks/storage';
import { isPlatform } from '@ionic/react';
import { CameraResultType, CameraSource, CameraPhoto, Capacitor, FilesystemDirectory } from "@capacitor/core";

const PHOTO_STORAGE = "photos";

export function usePhotoGallery() {

  const [photos, setPhotos] = useState<Photo[]>([]);
  const { getPhoto } = useCamera();
  const { deleteFile, getUri, readFile, writeFile } = useFilesystem();
  const { get, set } = useStorage();

  useEffect(() => {
    const loadSaved = async () => {
      const photosString = await get('photos');
      const photosInStorage = (photosString ? JSON.parse(photosString) : []) as Photo[];
      // If running on the web...
      if (!isPlatform('hybrid')) {
        for (let photo of photosInStorage) {
          const file = await readFile({
            path: photo.filepath,
            directory: FilesystemDirectory.Data
          });
          // Web platform only: Save the photo into the base64 field
          photo.base64 = `data:image/jpeg;base64,${file.data}`;
        }
      }
      setPhotos(photosInStorage);
    };
    loadSaved();
  }, [get, readFile]);

  const takePhoto = async () => {
    const cameraPhoto = await getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      quality: 100
    });
    const fileName = new Date().getTime() + '.jpeg';
    const savedFileImage = await savePicture(cameraPhoto, fileName);
    const newPhotos = [savedFileImage, ...photos];
    setPhotos(newPhotos);
    set(PHOTO_STORAGE,
      isPlatform('hybrid')
        ? JSON.stringify(newPhotos)
        : JSON.stringify(newPhotos.map(p => {
          // Don't save the base64 representation of the photo data, 
          // since it's already saved on the Filesystem
          const photoCopy = { ...p };
          delete photoCopy.base64;
          return photoCopy;
        })));

  };

  const savePicture = async (photo: CameraPhoto, fileName: string) => {
    let base64Data: string;
    // "hybrid" will detect Cordova or Capacitor;
    if (isPlatform('hybrid')) {
      const file = await readFile({
        path: photo.path!
      });
      base64Data = file.data;
    } else {
      base64Data = await base64FromPath(photo.webPath!);
    }
    await writeFile({
      path: fileName,
      data: base64Data,
      directory: FilesystemDirectory.Data
    });
    return getPhotoFile(photo, fileName);
  };


  const getPhotoFile = async (cameraPhoto: CameraPhoto, fileName: string): Promise<Photo> => {
    if (isPlatform('hybrid')) {
      // Get the new, complete filepath of the photo saved on filesystem
      const fileUri = await getUri({
        directory: FilesystemDirectory.Data,
        path: fileName
      });

      // Display the new image by rewriting the 'file://' path to HTTP
      // Details: https://ionicframework.com/docs/building/webview#file-protocol
      return {
        filepath: fileUri.uri,
        webviewPath: Capacitor.convertFileSrc(fileUri.uri),
      };
    }
    else {
      // Use webPath to display the new image instead of base64 since it's 
      // already loaded into memory
      return {
        filepath: fileName,
        webviewPath: cameraPhoto.webPath
      };
    }
  };

  const deletePhoto = async (photo: Photo) => {
    // Remove this photo from the Photos reference data array
    const newPhotos = photos.filter(p => p.filepath !== photo.filepath);

    // Update photos array cache by overwriting the existing photo array
    set(PHOTO_STORAGE, JSON.stringify(newPhotos));

    // delete photo file from filesystem
    const filename = photo.filepath.substr(photo.filepath.lastIndexOf('/') + 1);
    await deleteFile({
      path: filename,
      directory: FilesystemDirectory.Data
    });
    setPhotos(newPhotos);
  };

  return {
    deletePhoto,
    photos,
    takePhoto
  };
}

export interface Photo {
  filepath: string;
  webviewPath?: string;
  base64?: string;
}

