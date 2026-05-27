// Svelte action that traps keyboard focus inside an element while it's mounted.
//
// Behaviour:
//   - On mount: store document.activeElement (the trigger), then move focus to
//     the first focusable descendant.
//   - While mounted: Tab and Shift+Tab cycle within the trap. Focus cannot
//     escape to the page behind it.
//   - Escape calls the optional onClose handler so the host component can
//     dismiss the overlay.
//   - On destroy: restore focus to the originally-stored element.
//
// Usage:
//   <div use:trapFocus={{ onClose: () => (open = false) }}>
//     <button>...</button>
//   </div>
//
// Pair with the `inert` attribute on the background subtree so screen readers
// and the virtual cursor can't escape the modal either.

export interface TrapFocusOptions {
	/** Called when Escape is pressed inside the trap. Omit to disable Escape handling. */
	onClose?: () => void;
}

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(',');

export function trapFocus(node: HTMLElement, options: TrapFocusOptions = {}) {
	let { onClose } = options;
	const previousFocus = document.activeElement as HTMLElement | null;

	function getFocusable(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
			.filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && onClose) {
			e.preventDefault();
			e.stopPropagation();
			onClose();
			return;
		}
		if (e.key !== 'Tab') return;

		const focusable = getFocusable();
		if (focusable.length === 0) {
			e.preventDefault();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement as HTMLElement | null;

		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// Move focus into the trap on mount. Defer one frame so the DOM is settled
	// (transitions etc. may not have appended children yet).
	requestAnimationFrame(() => {
		const focusable = getFocusable();
		if (focusable.length > 0) {
			focusable[0].focus();
		} else {
			// No focusable child — make the wrapper itself focusable so the user
			// has somewhere to land for Escape to still work.
			node.tabIndex = -1;
			node.focus();
		}
	});

	node.addEventListener('keydown', onKeydown);

	return {
		update(newOptions: TrapFocusOptions) {
			onClose = newOptions.onClose;
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			// Restore focus only if the previously-focused element is still in
			// the document and visible. Otherwise let the browser pick.
			if (previousFocus && document.contains(previousFocus)) {
				previousFocus.focus();
			}
		},
	};
}
