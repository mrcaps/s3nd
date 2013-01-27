s3nd
====

A drag-and-drop multi-file upload widget written in javascript (Node).

The cute/new part is that (in theory) clients can begin downloads while other clients are uploading, thanks to the use of chunked uploads. One piece of metadata for each file keeps track of the byte count uploaded, and blocks clients until more data is received.

Uses MongoDB to keep track of file metadata and temporary names, and local filesystem to store the actual files. Deploy-able on Cloud Foundry (at least as it existed in approximately September 2011).