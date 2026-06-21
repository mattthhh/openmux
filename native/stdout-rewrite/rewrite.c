/**
 * stdout-rewrite — intercepts output on fd 1 to rewrite sentinel SGR
 * background sequences to the "default background" escape.
 *
 * When openmux runs inside a terminal emulator with background opacity/blur
 * (e.g., ghostty), the terminal content must not set explicit background
 * colors for default-bg cells. Otherwise the opaque bg color covers the
 * blur effect.
 *
 * This library intercepts write/writev/pwrite on fd 1 and replaces:
 *   \x1b[48;2;13;17;23m  (16 bytes)  →  \x1b[49m + NUL padding  (16 bytes)
 *
 * The replacement is the SAME length as the sentinel, so write() returns
 * the correct byte count and the caller's byte-accounting stays accurate.
 * The 11 NUL padding bytes following ESC[49m are silently ignored by
 * terminal emulators (NUL is a no-op in VT processing).
 *
 * Uses DYLD interpose (__DATA,__interpose) so that DYLD_INSERT_LIBRARIES
 * correctly overrides write() even in hardened-runtime binaries with the
 * com.apple.security.cs.allow-dyld-environment-variables entitlement.
 * On Linux, LD_PRELOAD replaces the write symbol directly.
 */

/* Required for RTLD_NEXT on glibc (Linux/Red Hat) */
#define _GNU_SOURCE
#include <string.h>
#include <unistd.h>
#include <stdlib.h>
#include <sys/uio.h>
#ifndef __APPLE__
#include <dlfcn.h>
#endif

/* Sentinel: \x1b[48;2;13;17;23m (16 bytes) */
static const char SENTINEL[] = "\x1b[48;2;13;17;23m";
/* Replacement: \x1b[49m (5 bytes) + 11 NUL padding bytes (total 16 bytes)
 * NUL bytes are no-ops in VT processing — terminals silently ignore them.
 * Same-length replacement avoids write() byte-count accounting breakage
 * (no need to lie about the return value, which caused data corruption). */
static const char REPLACEMENT[] = "\x1b[49m\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
#define SENTINEL_LEN 16
#define REPLACEMENT_LEN 16

/**
 * Rewrite sentinel occurrences in a buffer, replacing in-place.
 * Since SENTINEL_LEN == REPLACEMENT_LEN, the buffer length is unchanged.
 * Returns the buffer length (unchanged).
 */
static size_t rewrite_buffer_inplace(char *buf, size_t len) {
    const char *end = buf + len;

    for (char *s = buf; s <= end - SENTINEL_LEN; s++) {
        if (memcmp(s, SENTINEL, SENTINEL_LEN) == 0) {
            memcpy(s, REPLACEMENT, REPLACEMENT_LEN);
            s += SENTINEL_LEN - 1; /* -1 because the for-loop increments s */
        }
    }

    return len;
}

/**
 * Quick check: does the buffer contain the sentinel?
 */
static int contains_sentinel(const char *buf, size_t len) {
    if (len < SENTINEL_LEN) return 0;
    const char *end = buf + len;
    for (const char *s = buf; s <= end - SENTINEL_LEN; s++) {
        if (memcmp(s, SENTINEL, SENTINEL_LEN) == 0) return 1;
    }
    return 0;
}

#ifdef __APPLE__
#define REAL_WRITE write
#define REAL_WRITEV writev
#define REAL_PWRITE pwrite
#else
static ssize_t (*real_write)(int, const void *, size_t);
static ssize_t (*real_writev)(int, const struct iovec *, int);
static ssize_t (*real_pwrite)(int, const void *, size_t, off_t);

__attribute__((constructor))
static void init_real_functions(void) {
    real_write = (ssize_t (*)(int, const void *, size_t))dlsym(RTLD_NEXT, "write");
    real_writev = (ssize_t (*)(int, const struct iovec *, int))dlsym(RTLD_NEXT, "writev");
    real_pwrite = (ssize_t (*)(int, const void *, size_t, off_t))dlsym(RTLD_NEXT, "pwrite");
}

#define REAL_WRITE real_write
#define REAL_WRITEV real_writev
#define REAL_PWRITE real_pwrite
#endif

static ssize_t rewritten_write(int fd, const void *buf, size_t nbyte) {
    if (fd != 1 || nbyte < SENTINEL_LEN) {
        return REAL_WRITE(fd, buf, nbyte);
    }

    if (!contains_sentinel((const char *)buf, nbyte)) {
        return REAL_WRITE(fd, buf, nbyte);
    }

    /* Copy, rewrite in-place (same length), write */
    char *tmpbuf = (char *)malloc(nbyte);
    if (!tmpbuf) {
        return REAL_WRITE(fd, buf, nbyte);
    }

    memcpy(tmpbuf, buf, nbyte);
    rewrite_buffer_inplace(tmpbuf, nbyte);

    ssize_t result = REAL_WRITE(fd, tmpbuf, nbyte);
    free(tmpbuf);

    return result;
}

static ssize_t rewritten_writev(int fd, const struct iovec *iov, int iovcnt) {
    if (fd != 1 || iovcnt <= 0) {
        return REAL_WRITEV(fd, iov, iovcnt);
    }

    /* Calculate total original length */
    size_t original_total = 0;
    for (int i = 0; i < iovcnt; i++) {
        original_total += iov[i].iov_len;
    }

    /*
     * Always coalesce when there are multiple iovecs, because a sentinel
     * could straddle iovec boundaries. The previous individual-iovec quick
     * check missed this case, leading to unreplaced sentinels in the output.
     */
    if (iovcnt == 1) {
        /* Single iovec — no straddling possible, use write() path */
        if (iov[0].iov_len < SENTINEL_LEN ||
            !contains_sentinel((const char *)iov[0].iov_base, iov[0].iov_len)) {
            return REAL_WRITEV(fd, iov, iovcnt);
        }
    }

    /*
     * At least one iovec contains the sentinel.
     * Coalesce into a flat buffer (to handle straddling boundaries),
     * rewrite in-place (same length), write as write().
     *
     * We must coalesce because a sentinel could straddle two iovecs.
     * Using write() instead of writev() is fine — the interceptor
     * already serializes all output on fd 1, so atomicity is preserved.
     * Since the replacement is the same length, the return value
     * matches original_total and writev() byte-accounting is correct.
     */
    char *flat = (char *)malloc(original_total);
    if (!flat) {
        return REAL_WRITEV(fd, iov, iovcnt);
    }

    size_t off = 0;
    for (int i = 0; i < iovcnt; i++) {
        if (iov[i].iov_len > 0) {
            memcpy(flat + off, iov[i].iov_base, iov[i].iov_len);
            off += iov[i].iov_len;
        }
    }

    /* Also check for sentinel that straddled iovec boundaries */
    if (!contains_sentinel(flat, original_total)) {
        free(flat);
        return REAL_WRITEV(fd, iov, iovcnt);
    }

    rewrite_buffer_inplace(flat, original_total);

    ssize_t result = REAL_WRITE(fd, flat, original_total);
    free(flat);

    return result;
}

static ssize_t rewritten_pwrite(int fd, const void *buf, size_t nbyte, off_t offset) {
    if (fd != 1 || nbyte < SENTINEL_LEN) {
        return REAL_PWRITE(fd, buf, nbyte, offset);
    }

    if (!contains_sentinel((const char *)buf, nbyte)) {
        return REAL_PWRITE(fd, buf, nbyte, offset);
    }

    char *tmpbuf = (char *)malloc(nbyte);
    if (!tmpbuf) {
        return REAL_PWRITE(fd, buf, nbyte, offset);
    }

    memcpy(tmpbuf, buf, nbyte);
    rewrite_buffer_inplace(tmpbuf, nbyte);

    ssize_t result = REAL_PWRITE(fd, tmpbuf, nbyte, offset);
    free(tmpbuf);

    return result;
}

#ifdef __APPLE__
typedef struct interpose_s {
    const void *replacement;
    const void *original;
} interpose_t;

__attribute__((used))
static const interpose_t interposing_functions[]
    __attribute__((section("__DATA,__interpose"))) = {
        { (const void *)rewritten_write, (const void *)write },
        { (const void *)rewritten_writev, (const void *)writev },
        { (const void *)rewritten_pwrite, (const void *)pwrite },
    };
#else
ssize_t write(int fd, const void *buf, size_t nbyte) {
    return rewritten_write(fd, buf, nbyte);
}

ssize_t writev(int fd, const struct iovec *iov, int iovcnt) {
    return rewritten_writev(fd, iov, iovcnt);
}

ssize_t pwrite(int fd, const void *buf, size_t nbyte, off_t offset) {
    return rewritten_pwrite(fd, buf, nbyte, offset);
}
#endif
