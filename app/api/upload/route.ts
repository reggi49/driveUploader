import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UploadRequest = {
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  folderId?: string;
  newFolderName?: string;
};

export async function POST(request: Request) {
  try {
    console.log('--- [DEBUG] 1. Request received');

    const body = (await request.json()) as UploadRequest;
    const { fileName, fileType, fileSize, folderId, newFolderName } = body;

    console.log('--- [DEBUG] 2. Parsed request body', {
      fileName,
      fileType,
      fileSize,
      folderId,
      newFolderName
    });

    if (!fileName) {
      throw new Error('INVALID REQUEST: fileName is required');
    }

    console.log('--- [DEBUG] 3. Checking environment variables');

    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error('MISSING ENV: GOOGLE_CLIENT_ID');
    }
    if (!process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('MISSING ENV: GOOGLE_CLIENT_SECRET');
    }
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('MISSING ENV: GOOGLE_REFRESH_TOKEN');
    }
    if (!process.env.GOOGLE_FOLDER_ID) {
      throw new Error('MISSING ENV: GOOGLE_FOLDER_ID');
    }

    console.log('--- [DEBUG] 4. Initializing OAuth2 client');

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const rootFolderId = process.env.GOOGLE_FOLDER_ID;
    const trimmedFolderName = newFolderName?.trim();

    let targetFolderId = rootFolderId;

    if (trimmedFolderName) {
      console.log('--- [DEBUG] 5. Creating new folder', { trimmedFolderName });

      const folderResponse = await drive.files.create({
        requestBody: {
          name: trimmedFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootFolderId]
        },
        fields: 'id,name'
      });

      if (!folderResponse.data.id) {
        throw new Error('Failed to create new folder.');
      }

      targetFolderId = folderResponse.data.id;
      console.log('--- [DEBUG] 5.1 New folder created', {
        id: folderResponse.data.id,
        name: folderResponse.data.name
      });
    } else if (folderId?.trim()) {
      targetFolderId = folderId.trim();
      console.log('--- [DEBUG] 5. Using selected folder', { targetFolderId });
    } else {
      console.log('--- [DEBUG] 5. Using root folder', { targetFolderId });
    }

    console.log('--- [DEBUG] 6. Requesting resumable session (OAuth2)');

    const response = await drive.files.create(
      {
        requestBody: {
          name: fileName,
          mimeType: fileType,
          parents: [targetFolderId]
        },
        media: {
          mimeType: fileType,
          body: ''
        },
        fields: 'id'
      },
      {
        url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('--- [DEBUG] 7. Google response headers', response.headers);

    const uploadUrl = response.headers.location as string | undefined;
    if (!uploadUrl) {
      throw new Error('Google did not return a Location header (Upload URL).');
    }

    console.log('--- [DEBUG] 8. SUCCESS! Returning upload URL');

    return NextResponse.json({ uploadUrl });
  } catch (error) {
    console.error('--- [ERROR LOG START] ---');

    const err = error as {
      message?: string;
      response?: { data?: unknown };
    };

    console.error('Message:', err?.message ?? 'Unknown error');

    if (err?.response?.data) {
      console.error('Google API Error Details:', JSON.stringify(err.response.data, null, 2));
    }

    console.error('--- [ERROR LOG END] ---');

    return NextResponse.json(
      {
        error: err?.message ?? 'Unknown error',
        details: err?.response?.data ?? null
      },
      { status: 500 }
    );
  }
}
