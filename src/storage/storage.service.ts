import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
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
  presignRead(photo_key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: photo_key }),
      { expiresIn: 300 },
    );
  }
  async putMask(key: string, png: Buffer, source = 'sam') {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        Metadata: { 'outline-source': source },
      }),
    );
  }
  async readMask(key: string) {
    if (
      !/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.png$/.test(key)
    )
      throw new Error('Invalid preview mask key');
    return this.readObject(key, 4 * 1024 * 1024);
  }
  async readPhoto(key: string): Promise<Buffer> {
    if (!/^captures\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(key))
      throw new Error('Invalid capture photo key');
    return this.readObject(key, 25 * 1024 * 1024);
  }
  private async readObject(key: string, max: number): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    const body = object.Body as Readable | undefined;
    if (!body) throw new Error('Photo body missing');
    if ((object.ContentLength ?? 0) > max) {
      body.destroy();
      throw new Error('Photo exceeds analysis size limit');
    }
    const parts: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > max) throw new Error('Photo exceeds analysis size limit');
        parts.push(bytes);
      }
      return Buffer.concat(parts);
    } finally {
      body.destroy();
    }
  }
  async putAnalysisPhoto(key: string, jpeg: Buffer) {
    if (
      !/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.jpg$/.test(key)
    )
      throw new Error('Invalid analysis photo key');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: jpeg,
        ContentType: 'image/jpeg',
      }),
    );
  }
  async removeMask(key: string) {
    if (
      !/^(masks|previews)\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.png$/.test(
        key,
      ) &&
      !/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.jpg$/.test(key)
    )
      throw new Error('Invalid generated mask key');
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async confirmMask(preview: string, key: string) {
    if (
      !/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.png$/.test(
        preview,
      )
    )
      throw new Error('Invalid preview mask key');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${preview}`,
        ContentType: 'image/png',
        MetadataDirective: 'COPY',
      }),
    );
  }
}
