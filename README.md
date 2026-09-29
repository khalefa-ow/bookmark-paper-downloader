# Bookmark Paper Sweeper

A local Chrome extension that scans every bookmark folder, identifies papers, PDFs, and technical pages, reviews/removes duplicate bookmarks, and downloads unique PDFs. Every detected item shows the bookmark folder where it is listed.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `bookmark-paper-downloader` folder.
5. Open the extension and choose any combination of **Bookmarks**, **Tab groups**, and ungrouped **Open tabs**, then click **Scan selected pages**.

Chrome saves files under `Downloads/Bookmark Papers`. The extension asks for confirmation before deleting duplicate bookmarks and always keeps the first copy encountered.

## Detection

Automatic PDF downloads work for direct `.pdf` bookmarks plus arXiv, OpenReview, bioRxiv, medRxiv, ACL Anthology, and PMLR links. DOI and major publisher pages are identified as papers, but are not auto-downloaded because they may require login, payment, or license acceptance.

**Tab groups** queries every currently open named group and its tabs directly from Chrome. **Open tabs** queries current ungrouped tabs. Closed groups are not stored or scanned.

Technical-page detection covers database systems and SQL, programming documentation, APIs, package registries, code repositories, technical Q&A, web standards, platform documentation, university course material, computer-science research indexes, and strong computer-science terms in page titles and URLs. After every scan, **All scanned links** lists each URL as Paper, Technical, Other, or Filtered and explains the decision. Other means a valid web page that matched no specialized rule; Filtered is reserved for invalid URLs and unsupported schemes. The JSON export includes the same decisions.

Duplicate matching normalizes host casing, trailing slashes, URL fragments, and common tracking parameters. The extension does not upload bookmark data anywhere.
