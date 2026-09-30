/**
 * Minimal stand-ins for `next/image` and `next/link`.
 *
 * `next/image` requires the Next runtime config (loader, remotePatterns) and
 * `next/link` requires the App Router context; neither exists in jsdom.
 * Both render plain elements so role/text queries keep working.
 */
import * as React from "react";
import { router } from "./router";

type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string | { src: string };
  alt: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
};

export const NextImage = React.forwardRef<HTMLImageElement, ImageProps>(function NextImage(
  { src, alt, fill, priority, unoptimized, quality, placeholder, blurDataURL, ...rest },
  ref
) {
  void fill;
  void priority;
  void unoptimized;
  void quality;
  void placeholder;
  void blurDataURL;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={typeof src === "string" ? src : src.src} alt={alt} {...rest} />;
});

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export const NextLink = React.forwardRef<HTMLAnchorElement, LinkProps>(function NextLink(
  { href, prefetch, replace, scroll, children, onClick, ...rest },
  ref
) {
  void prefetch;
  void scroll;
  const target = typeof href === "string" ? href : (href.pathname ?? "/");
  return (
    <a
      ref={ref}
      href={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // jsdom cannot navigate; route through the fake router instead.
        event.preventDefault();
        (replace ? router.replace : router.push)(target);
      }}
      {...rest}
    >
      {children}
    </a>
  );
});
