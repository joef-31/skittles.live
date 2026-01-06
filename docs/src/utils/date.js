
function isoDateOnly(iso) {
    if (!iso) return null;
    return iso.split("T")[0];
}

function isToday(dateStr) {
    return dateStr === new Date().toISOString().split("T")[0];
}

function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

window.isoDateOnly = isoDateOnly;
window.isToday = isToday;
window.clampDatesAroundToday = clampDatesAroundToday;
