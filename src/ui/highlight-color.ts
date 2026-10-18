/** Choose the higher-contrast text color for a validated six-digit highlight color. */
export function highlightTextColor(color: string): '#000000' | '#ffffff' {
	const channels = [1, 3, 5].map((offset) => {
		const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
	return luminance > 0.179 ? '#000000' : '#ffffff';
}
