/**
 * Performance Optimization Utilities
 * Lazy loading, intersection observers, and image optimization
 */

// Performance Configuration
const PERF_CONFIG = {
    LAZY_LOAD_THRESHOLD: 0.1,
    IMAGE_QUALITY: 0.85,
    DEBOUNCE_DELAY: 150
};

/**
 * Initialize lazy loading for images
 */
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver(
            (entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;

                        // Load the image
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                        }
                        if (img.dataset.srcset) {
                            img.srcset = img.dataset.srcset;
                        }

                        // Remove the blur effect
                        img.classList.remove('lazy');
                        img.classList.add('lazy-loaded');

                        // Stop observing this image
                        observer.unobserve(img);
                    }
                });
            },
            {
                root: null,
                rootMargin: '50px',
                threshold: PERF_CONFIG.LAZY_LOAD_THRESHOLD
            }
        );

        // Observe all lazy images
        document.querySelectorAll('img[data-src], img[data-srcset]').forEach(img => {
            imageObserver.observe(img);
        });

        console.log('[Performance] Lazy loading initialized');
    } else {
        // Fallback for browsers without IntersectionObserver
        document.querySelectorAll('img[data-src]').forEach(img => {
            if (img.dataset.src) {
                img.src = img.dataset.src;
            }
        });
        console.warn('[Performance] IntersectionObserver not supported, loading all images');
    }
}

/**
 * Debounce function for performance optimization
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, wait = PERF_CONFIG.DEBOUNCE_DELAY) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function for scroll/resize events
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum time between executions
 * @returns {Function} - Throttled function
 */
function throttle(func, limit = 100) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Optimize image loading with responsive sizes
 * @param {HTMLImageElement} img - Image element
 */
function optimizeImage(img) {
    // Add responsive image attributes if not present
    if (!img.hasAttribute('loading')) {
        img.setAttribute('loading', 'lazy');
    }

    if (!img.hasAttribute('decoding')) {
        img.setAttribute('decoding', 'async');
    }

    // Add error handler
    img.onerror = function() {
        this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjNDQ0Ii8+Cjx0ZXh0IHg9IjI1IiB5PSIyNSIgZmlsbD0iIzg4OCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSI4Ij5JTUFHRTwvdGV4dD4KPC9zdmc+';
        this.alt = 'Image failed to load';
    };
}

/**
 * Prefetch critical resources
 * @param {string[]} urls - URLs to prefetch
 */
function prefetchResources(urls) {
    urls.forEach(url => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        document.head.appendChild(link);
    });
}

/**
 * Monitor Core Web Vitals
 */
function monitorWebVitals() {
    if ('PerformanceObserver' in window) {
        // Largest Contentful Paint (LCP)
        const lcpObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const lastEntry = entries[entries.length - 1];
            console.log('[Performance] LCP:', lastEntry.renderTime || lastEntry.loadTime);
        });

        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

        // First Input Delay (FID)
        const fidObserver = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                console.log('[Performance] FID:', entry.processingStart - entry.startTime);
            });
        });

        fidObserver.observe({ type: 'first-input', buffered: true });

        // Cumulative Layout Shift (CLS)
        let clsScore = 0;
        const clsObserver = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                if (!entry.hadRecentInput) {
                    clsScore += entry.value;
                }
            });
            console.log('[Performance] CLS:', clsScore);
        });

        clsObserver.observe({ type: 'layout-shift', buffered: true });
    }
}

/**
 * Request Idle Callback wrapper with fallback
 * @param {Function} callback - Function to execute during idle time
 * @param {Object} options - Options object
 */
function requestIdleCallback(callback, options) {
    if ('requestIdleCallback' in window) {
        return window.requestIdleCallback(callback, options);
    } else {
        return setTimeout(callback, 1);
    }
}

/**
 * Initialize all performance optimizations
 */
function initPerformanceOptimizations() {
    // Lazy load images
    initLazyLoading();

    // Optimize all existing images
    document.querySelectorAll('img').forEach(optimizeImage);

    // Monitor Web Vitals in development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        monitorWebVitals();
    }

    // Log performance metrics
    window.addEventListener('load', () => {
        const perfData = window.performance.timing;
        const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
        const connectTime = perfData.responseEnd - perfData.requestStart;
        const renderTime = perfData.domComplete - perfData.domLoading;

        console.log('[Performance] Page Load Time:', pageLoadTime + 'ms');
        console.log('[Performance] Connection Time:', connectTime + 'ms');
        console.log('[Performance] Render Time:', renderTime + 'ms');
    });
}

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPerformanceOptimizations);
} else {
    initPerformanceOptimizations();
}

// Export functions for use in other modules
window.performanceUtils = {
    debounce,
    throttle,
    optimizeImage,
    prefetchResources,
    requestIdleCallback
};
