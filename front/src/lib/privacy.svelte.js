// Discreet mode: a neutral tab title and icon, kept between visits. Hide: blanks the page at
// once (B key or the header button) and pauses any video, until B or a click brings it back.
const STORAGE_KEY = 'hg.discreet';

export const NEUTRAL_TITLE = 'Notes';
export const NEUTRAL_ICON =
	'data:image/svg+xml,' +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="3" width="22" height="26" rx="3" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2"/><path d="M10 11h12M10 16h12M10 21h8" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/></svg>'
	);

export const privacy = $state({ discreet: false, hidden: false });

export function loadPrivacy() {
	try {
		privacy.discreet = localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		privacy.discreet = false;
	}
}

export function setDiscreet(value) {
	privacy.discreet = value;
	try {
		localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
	} catch {
		// Private browsing without storage: the setting lasts until the tab closes.
	}
}

export function hideNow() {
	privacy.hidden = true;
	for (const video of document.querySelectorAll('video')) video.pause();
}

export function unhide() {
	privacy.hidden = false;
}
