type MobilePlayTarget = 'music' | 'playlist';

export function createMobilePlayLink(target: MobilePlayTarget, id: string | number) {
    const server = encodeURIComponent(window.location.origin);
    return `oceanwave://play/${target}/${id}?server=${server}`;
}

export function openMobilePlayLink(target: MobilePlayTarget, id: string | number) {
    window.location.href = createMobilePlayLink(target, id);
}
