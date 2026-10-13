<?php
/**
 * Administrator-only environment and reachability diagnostics.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Rest_Api
{
    public static function register(): void
    {
        register_rest_route(
            'zibll-pixiv/v1',
            '/environment',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array(__CLASS__, 'environment'),
                'permission_callback' => static function (): bool {
                    return current_user_can('manage_options');
                },
            )
        );
    }

    /**
     * @return WP_REST_Response
     */
    public static function environment(): WP_REST_Response
    {
        global $wp_rewrite, $wpdb;

        $options = Zibll_Pixiv_Settings::get();
        $php_version = PHP_VERSION;
        $wp_version = get_bloginfo('version');
        $db_version = method_exists($wpdb, 'db_version') ? $wpdb->db_version() : '';
        $theme = wp_get_theme();
        $rewrite = (bool) get_option('permalink_structure');
        $probes = array();

        foreach (Zibll_Pixiv_Request_Policy::configured_domains($options) as $domain) {
            $probes[$domain] = Zibll_Pixiv_Request_Policy::probe($domain, min(5, (int) $options['timeout']));
        }

        return new WP_REST_Response(
            array(
                'php' => array(
                    'version' => $php_version,
                    'meets_minimum' => version_compare($php_version, '8.0', '>='),
                ),
                'wordpress' => array(
                    'version' => $wp_version,
                    'meets_minimum' => version_compare($wp_version, '7.0', '>='),
                ),
                'database' => array(
                    'version' => $db_version,
                    'meets_minimum' => $db_version === '' || version_compare($db_version, '8.0', '>='),
                ),
                'theme' => array(
                    'name' => $theme->get('Name'),
                    'version' => $theme->get('Version'),
                    'active' => $theme->exists(),
                ),
                'rewrite' => array(
                    'permalink_structure' => (string) get_option('permalink_structure'),
                    'configured' => $rewrite,
                    'rules_loaded' => is_object($wp_rewrite) && ! empty($wp_rewrite->rules),
                ),
                'proxy' => $probes,
                'filter' => Zibll_Pixiv_Settings::blocklist_status($options),
                'server_image_proxy' => false,
            )
        );
    }
}
