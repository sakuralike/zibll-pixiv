<?php
/**
 * Proxy domain and remote health policy.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Request_Policy
{
    /**
     * Allowed proxy domains. These are deliberately not user-controlled.
     *
     * @var string[]
     */
    private const ALLOWED_DOMAINS = array('pixiv.re', 'pixiv.nl');

    /**
     * Get a normalized option value for a proxy host.
     */
    public static function normalize_domain($value, string $fallback): string
    {
        $domain = strtolower(trim((string) $value));
        $domain = preg_replace('~^https?://~', '', $domain);
        $domain = trim((string) $domain, "/ \t\n\r\0\x0B");
        if (! in_array($domain, self::ALLOWED_DOMAINS, true)) {
            return $fallback;
        }

        return $domain;
    }

    /**
     * Return the configured primary/backup hosts.
     *
     * @return string[]
     */
    public static function configured_domains(array $options): array
    {
        $primary = self::normalize_domain($options['primary_domain'] ?? '', 'pixiv.re');
        $backup  = self::normalize_domain($options['backup_domain'] ?? '', 'pixiv.nl');
        $domains = array($primary);

        if (! empty($options['failover']) && $backup !== $primary) {
            $domains[] = $backup;
        }

        return $domains;
    }

    /**
     * Build one browser-facing image URL.
     */
    public static function image_url(string $domain, string $id, int $page = 1): string
    {
        return Zibll_Pixiv_Id_Parser::build_proxy_url($domain, $id, $page);
    }

    /**
     * Probe an endpoint without downloading an image body.
     *
     * @return array{status:string,http_code:int,message:string,domain:string}
     */
    public static function probe(string $domain, int $timeout = 5): array
    {
        $domain = self::normalize_domain($domain, '');
        if ($domain === '') {
            return array(
                'status'    => 'blocked',
                'http_code' => 0,
                'message'   => __('域名不在允许列表中', 'zibll-pixiv'),
                'domain'    => '',
            );
        }

        $url = 'https://' . $domain . '/1.jpg';
        $response = wp_remote_head(
            $url,
            array(
                'timeout'     => max(1, min(15, $timeout)),
                'redirection' => 2,
                'headers'     => array('Accept' => 'image/*'),
            )
        );

        if (is_wp_error($response)) {
            return array(
                'status'    => 'unreachable',
                'http_code' => 0,
                'message'   => $response->get_error_message(),
                'domain'    => $domain,
            );
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code >= 200 && $code < 500) {
            return array(
                'status'    => 'reachable',
                'http_code' => $code,
                'message'   => __('代理域名可连接（作品 1 的状态仅用于连通性探测）', 'zibll-pixiv'),
                'domain'    => $domain,
            );
        }

        return array(
            'status'    => 'unreachable',
            'http_code' => $code,
            'message'   => sprintf(__('代理服务返回 HTTP %d', 'zibll-pixiv'), $code),
            'domain'    => $domain,
        );
    }

    /**
     * Expose the allowlist for diagnostics/tests.
     *
     * @return string[]
     */
    public static function allowed_domains(): array
    {
        return self::ALLOWED_DOMAINS;
    }
}
