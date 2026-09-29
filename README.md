# Bookmark Paper Sweeper

A local Chrome extension that scans every bookmark folder, identifies papers, PDFs, and technical pages, reviews/removes duplicate bookmarks, and downloads unique PDFs. Every detected item shows the bookmark folder where it is listed.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `bookmark-paper-downloader` folder.
5. Open the extension, choose **All groups** or one bookmark group, optionally enable **Include open tabs** and choose a tab group, then click **Scan selected group**.

Chrome saves files under `Downloads/Bookmark Papers`. The extension asks for confirmation before deleting duplicate bookmarks and always keeps the first copy encountered.

## Detection

Automatic PDF downloads work for direct `.pdf` bookmarks plus arXiv, OpenReview, bioRxiv, medRxiv, ACL Anthology, and PMLR links. DOI and major publisher pages are identified as papers, but are not auto-downloaded because they may require login, payment, or license acceptance.

Open tabs can optionally be included in a scan, filtered to a named tab group or ungrouped tabs, and are labeled by tab group and browser window; they are never affected by duplicate-bookmark removal.

Technical-page detection covers common documentation, API/reference/guide/tutorial URLs, GitHub repositories, Stack Exchange technical questions, and established technical publishing sites. These pages are listed separately and are never sent to the PDF downloader.

Duplicate matching normalizes host casing, trailing slashes, URL fragments, and common tracking parameters. The extension does not upload bookmark data anywhere.
