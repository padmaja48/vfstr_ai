import { UploadApiResponse } from 'cloudinary';
import { cloudinary } from '../config/cloudinary';
import { env } from '../config/env';
import { createPublicId } from '../utils/crypto';

export type StoredFile = {
  url: string;
  publicId?: string;
  resourceType?: string;
};

export const uploadBuffer = async (
  file: Express.Multer.File,
  folder: 'resumes' | 'profiles' | 'recordings' | 'reports' | 'listening-audio',
): Promise<StoredFile> => {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return {
      url: `mock-cloudinary://${folder}/${createPublicId(file.originalname.replace(/\W+/g, '_'))}`,
      resourceType: file.mimetype,
    };
  }

  const response = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `fluentai/${folder}`,
        resource_type: 'auto',
        public_id: createPublicId(folder),
        access_mode: 'authenticated',
      },
      (error, result) => {
        if (error || !result) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );

    stream.end(file.buffer);
  });

  return {
    url: response.secure_url,
    publicId: response.public_id,
    resourceType: response.resource_type,
  };
};

export const uploadText = async (
  text: string,
  fileName: string,
  folder: 'reports',
): Promise<StoredFile> => {
  const file = {
    buffer: Buffer.from(text),
    originalname: fileName,
    mimetype: 'application/json',
  } as Express.Multer.File;

  return uploadBuffer(file, folder);
};
