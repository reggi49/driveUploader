import FileUploader from '@/components/FileUploader';

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Google Drive Direct Upload</p>
          <h1 className="text-4xl font-semibold text-white md:text-5xl">Unlimited File Uploader</h1>
          <p className="max-w-2xl text-base text-slate-300 md:text-lg">
            This uploader creates a resumable session on the server, then streams your file straight to Google Drive.
            Files never pass through Vercel functions, so large uploads are safe.
          </p>
        </header>
        <FileUploader />
      </div>
    </main>
  );
}
