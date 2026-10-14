import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('SPACES_BUCKET');
    const endpoint = config.getOrThrow<string>('SPACES_ENDPOINT');
    const region = new URL(endpoint).hostname.split('.')[0];
    this.client = new S3Client({
      requestChecksumCalculation: 'WHEN_REQUIRED',
      endpoint,
      region,
      credentials: {
        accessKeyId: config.getOrThrow<string>('SPACES_KEY'),
        secretAccessKey: config.getOrThrow<string>('SPACES_SECRET'),
      },
    });
  }
  async presign(photo_key: string) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: photo_key,
        ContentType: 'image/jpeg',
      }),
      { expiresIn: 300 },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      expires_in: 300,
    };
  }
  async exists(photo_key: string): Promise<boolean> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: photo_key }),
      );
      return (
        result.ContentType === 'image/jpeg' && (result.ContentLength ?? 0) > 0
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return false;
      throw error;
    }
  }
}
