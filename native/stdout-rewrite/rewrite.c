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
 *   \x1b[48;2;13;17;23m  (16 bytes)  →  \x1b[49m  (5 bytes)
 *
 * The replacement is 11 bytes shorter per occurrence. The buffer is
 * compacted in-place. To preserve caller byte-accounting, write() and
 * writev() return the ORIGINAL byte count (before compaction), not the
 * actual number of bytes sent to the terminal. The host terminal
 * receives the correct visual output; the caller never notices the
 * shrinkage.
 *
 * Uses DYLD interpose (__DATA,__interpose) so that DYLD_INSERT_LIBRARIES
 * correctly overrides write() even in hardened-runtime binaries with the
 * com.apple.security.cs.allow-dyld-environment-variables entitlement.
 * On Linux, LD_PRELOAD replaces the write symbol directly.
 */

#include <string.h>
#include <unistd.h>
#include <stdlib.h>
#include <sys/uio.h>

/* Sentinel: \x1b[48;2;13;17;23m (16 bytes) */
static const char SENTINEL[] = "\x1b[48;2;13;17;23m";
/* Replacement: \x1b[49m — "default background" (5 bytes) */
static const char REPLACEMENT[] = "\x1b[49m";
#define SENTINEL_LEN 16
#define REPLACEMENT_LEN 5
#define SHRINK_PER_REPLACE (SENTINEL_LEN - REPLACEMENT_LEN) /* 11 */

/**
 * Rewrite sentinel occurrences in a buffer, compacting in-place.
 * Returns the new length of the buffer.
 */
static size_t rewrite_buffer_inplace(char *buf, size_t len) {
    const char *src = buf;
    const char *end = buf + len;
    char *dst = buf;

    while (src < end) {
        if (src <= end - SENTINEL_LEN &&
            memcmp(src, SENTINEL, SENTINEL_LEN) == 0) {
            memcpy(dst, REPLACEMENT, REPLACEMENT_LEN);
            dst += REPLACEMENT_LEN;
            src += SENTINEL_LEN;
        } else {
            *dst++ = *src++;
        }
    }

    return (size_t)(dst - buf);
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

/**
 * Count sentinel occurrences in a buffer.
 */
static int count_sentinels(const char *buf, size_t len) {
    int count = 0;
    const char *end = buf + len;
    for (const char *s = buf; s <= end - SENTINEL_LEN; s++) {
        if (memcmp(s, SENTINEL, SENTINEL_LEN) == 0) count++;
    }
    return count;
}

static ssize_t rewritten_write(int fd, const void *buf, size_t nbyte) {
    if (fd != 1 || nbyte < SENTINEL_LEN) {
        return write(fd, buf, nbyte);
    }

    if (!contains_sentinel((const char *)buf, nbyte)) {
        return write(fd, buf, nbyte);
    }

    /* Copy, compact, write */
    size_t original_len = nbyte;
    char *tmpbuf = (char *)malloc(nbyte);
    if (!tmpbuf) {
        return write(fd, buf, nbyte);
    }

    memcpy(tmpbuf, buf, nbyte);
    size_t new_len = rewrite_buffer_inplace(tmpbuf, nbyte);

    ssize_t result = write(fd, tmpbuf, new_len);
    free(tmpbuf);

    /* Return ORIGINAL byte count so caller's accounting stays correct */
    if (result >= 0) return (ssize_t)original_len;
    return result;
}

static ssize_t rewritten_writev(int fd, const struct iovec *iov, int iovcnt) {
    if (fd != 1 || iovcnt <= 0) {
        return writev(fd, iov, iovcnt);
    }

    /* Calculate total original length and check for sentinel */
    size_t original_total = 0;
    int needs_rewrite = 0;

    for (int i = 0; i < iovcnt; i++) {
        original_total += iov[i].iov_len;
        if (!needs_rewrite && iov[i].iov_len >= SENTINEL_LEN) {
            needs_rewrite = contains_sentinel(
                (const char *)iov[i].iov_base, iov[i].iov_len);
        }
    }

    if (!needs_rewrite) {
        return writev(fd, iov, iovcnt);
    }

    /*
     * At least one iovec contains the sentinel.
     * Coalesce into a flat buffer (to handle straddling boundaries),
     * rewrite, write as write(), return original byte count.
     *
     * We must coalesce because a sentinel could straddle two iovecs.
     * Using write() instead of writev() is fine — the interceptor
     * already serializes all output on fd 1, so atomicity is preserved.
     */
    char *flat = (char *)malloc(original_total);
    if (!flat) {
        return writev(fd, iov, iovcnt);
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
        return writev(fd, iov, iovcnt);
    }

    size_t new_len = rewrite_buffer_inplace(flat, original_total);

    ssize_t result = write(fd, flat, new_len);
    free(flat);

    if (result >= 0) return (ssize_t)original_total;
    return result;
}

static ssize_t rewritten_pwrite(int fd, const void *buf, size_t nbyte, off_t offset) {
    if (fd != 1 || nbyte < SENTINEL_LEN) {
        return pwrite(fd, buf, nbyte, offset);
    }

    if (!contains_sentinel((const char *)buf, nbyte)) {
        return pwrite(fd, buf, nbyte, offset);
    }

    size_t original_len = nbyte;
    char *tmpbuf = (char *)malloc(nbyte);
    if (!tmpbuf) {
        return pwrite(fd, buf, nbyte, offset);
    }

    memcpy(tmpbuf, buf, nbyte);
    size_t new_len = rewrite_buffer_inplace(tmpbuf, nbyte);

    ssize_t result = pwrite(fd, tmpbuf, new_len, offset);
    free(tmpbuf);

    if (result >= 0) return (ssize_t)original_len;
    return result;
}

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
