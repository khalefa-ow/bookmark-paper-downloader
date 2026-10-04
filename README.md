# Bookmark Paper Sweeper

A local Chrome extension that collects tabs from every open window into a dashboard, preserves tab-group context, identifies papers, PDFs, and technical pages, reviews/removes duplicate bookmarks, and downloads unique PDFs.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `bookmark-paper-downloader` folder.
5. Open the extension and choose any combination of **Bookmarks**, **Tab groups**, and ungrouped **Open tabs**, then click **Scan selected pages**.

## Tab dashboard

Click **Organize tabs** in the extension popup to see HTTP(S) tabs from every normal Chrome window. Tabs are ordered by their existing group name and source window. The dashboard can search and filter the collection, show downloaded versus not-downloaded items, close individual tabs, or—after confirmation—close the full collection.

Select cards in the dashboard to regroup their real Chrome tabs. Selected tabs can be added to an existing group, placed into a newly named and colored group, or removed from groups. New groups are created once per source window; applying an existing group moves tabs from other windows into that group's window. Chrome requires pinned tabs to be unpinned before grouping.

Use **Select group** to select every tab in an existing group, then choose **Group by category** to sort the selection into **Papers**, **Technical**, and **Other** tab groups. Tabs may be selected across multiple groups or from ungrouped sections; categories are created separately in each source window.

Use **Remove all groups** to ungroup every tab across all open windows without closing or moving tabs. You can then select the collected tabs and build a new group structure.

**Organize into one window** moves the collected tabs to a new Chrome window and recreates their original groups. Ungrouped tabs are placed in a group named for their source window, so their provenance is not lost. Pinned tabs remain pinned and are not placed in a Chrome tab group.

Each card has a short local description. **Generate descriptions** uses Chrome's on-device Language Model API when the browser supports it; bookmark and tab data is not sent to a remote model. If the API is unavailable, the dashboard keeps its local descriptions.

Chrome saves files under `Downloads/Bookmark Papers`. The extension asks for confirmation before deleting duplicate bookmarks and always keeps the first copy encountered.

## Detection

Automatic PDF downloads work for direct `.pdf` bookmarks plus arXiv, OpenReview, bioRxiv, medRxiv, ACL Anthology, and PMLR links. DOI and major publisher pages are identified as papers, but are not auto-downloaded because they may require login, payment, or license acceptance.

**Tab groups** queries every currently open named group and its tabs directly from Chrome. **Open tabs** queries current ungrouped tabs. Closed groups are not stored or scanned.

Technical-page detection covers database systems and SQL, programming documentation, APIs, package registries, code repositories, technical Q&A, web standards, platform documentation, university course material, computer-science research indexes, and strong computer-science terms in page titles and URLs. After every scan, **All scanned links** lists each URL as Paper, Technical, Other, or Filtered and explains the decision. Other means a valid web page that matched no specialized rule; Filtered is reserved for invalid URLs and unsupported schemes. The JSON export includes the same decisions.

Duplicate matching normalizes host casing, trailing slashes, URL fragments, and common tracking parameters. The extension does not upload bookmark data anywhere.
