import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UploadRequest = {
  fileName?: string;
  fileType?: string;
  fileSize?: number;
};

export async function POST(request: Request) {
  try {
    console.log('--- [DEBUG] 1. Request received');

    const body = (await request.json()) as UploadRequest;
    const { fileName, fileType, fileSize } = body;
    const safeFileType = fileType || 'application/octet-stream';

    console.log('--- [DEBUG] 2. Parsed request body', { fileName, fileType: safeFileType, fileSize });

    if (!fileName) {
      throw new Error('INVALID REQUEST: fileName is required');
    }

    console.log('--- [DEBUG] 3. Checking environment variables');

    if (!process.env.GOOGLE_CREDENTIALS) {
      throw new Error('MISSING ENV: GOOGLE_CREDENTIALS');
    }
    if (!process.env.GOOGLE_FOLDER_ID) {
      throw new Error('MISSING ENV: GOOGLE_FOLDER_ID');
    }

    console.log('--- [DEBUG] 4. Parsing GOOGLE_CREDENTIALS JSON');

    let credentials: Record<string, unknown>;
    const folderId = process.env.GOOGLE_FOLDER_ID;
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      console.log('========================================');
      console.log('🤖 IDENTITAS ROBOT YANG DIPAKAI:');
      console.log('Email:', (credentials as { client_email?: string }).client_email);
      console.log('Project ID:', (credentials as { project_id?: string }).project_id);
      console.log('Target Folder:', process.env.GOOGLE_FOLDER_ID);
      console.log('========================================');
      console.log('--- [DEBUG] 5. Credentials parsed', {
        projectId: (credentials as { project_id?: string }).project_id,
        clientEmail: (credentials as { client_email?: string }).client_email
      });
    } catch (error) {
      console.error('--- [FATAL] FAILED TO PARSE JSON CREDENTIALS');
      throw new Error('Invalid JSON format in GOOGLE_CREDENTIALS. Check .env.local for newlines.');
    }

    console.log('--- [DEBUG] 6. Initializing Google Auth');

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    console.log('--- [DEBUG] 7. Checking folder access', { folderId });

    let folderCheck: { id?: string; name?: string; trashed?: boolean } | null = null;
    try {
      const folderResponse = await auth.request<{
        id: string;
        name: string;
        trashed?: boolean;
      }>({
        url: `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
        method: 'GET'
      });
      folderCheck = folderResponse.data;
      console.log('--- [DEBUG] 7.1 Folder access OK', folderCheck);
    } catch (error) {
      console.error('--- [ERROR] Folder access check failed');
      const err = error as { response?: { data?: unknown } };
      if (err?.response?.data) {
        console.error('Folder access error details:', JSON.stringify(err.response.data, null, 2));
      }
      throw new Error('SERVICE ACCOUNT CANNOT ACCESS GOOGLE_FOLDER_ID');
    }

    console.log('--- [DEBUG] 8. Requesting resumable session (relaxed headers)');

    const response = await auth.request<{ id: string }>({
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      method: 'POST',
      data: {
        name: fileName,
        mimeType: safeFileType,
        parents: [folderId]
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('--- [DEBUG] 9. Google response headers', response.headers);

    const uploadUrl = response.headers.location as string | undefined;
    if (!uploadUrl) {
      throw new Error('Google did not return a Location header (Upload URL).');
    }

    console.log('--- [DEBUG] 10. SUCCESS! Returning upload URL');

    return NextResponse.json({
      uploadUrl,
      debug: {
        folderId,
        folderCheck,
        projectId: (credentials as { project_id?: string }).project_id,
        clientEmail: (credentials as { client_email?: string }).client_email,
        sessionCreatedAt: new Date().toISOString(),
        fileType: safeFileType
      }
    });
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
