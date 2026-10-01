// jsdom doesn't implement File.text() or DataTransfer — both are standard in real Chrome, where
// this extension actually runs. These minimal shims exist only so the file-upload logic
// (resumeUpload.ts) can be exercised in tests.

if (!("text" in File.prototype)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (File.prototype as any).text = function (this: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

if (typeof (globalThis as { DataTransfer?: unknown }).DataTransfer === "undefined") {
  class FakeDataTransfer {
    private _files: File[] = [];
    items = {
      add: (file: File) => {
        this._files.push(file);
      },
    };
    get files(): FileList {
      const files = this._files;
      return {
        length: files.length,
        item: (i: number) => files[i] ?? null,
        [Symbol.iterator]: () => files[Symbol.iterator](),
        ...files,
      } as unknown as FileList;
    }
  }
  (globalThis as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer;
}
