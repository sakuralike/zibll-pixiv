<?php
/**
 * Plugin Name: Zibll Pixiv 图片查看器
 * Plugin URI: https://github.com/sakuralike/zibll-pixiv
 * Description: 使用 pixiv.re / pixiv.nl 代理按 Pixiv 作品 ID 预览单张图片，并提供单张浏览器下载。
 * Version: 0.1.0
 * Requires at least: 7.0
 * Requires PHP: 8.0
 * Tested up to: 7.1
 * Author: sakuralike
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: zibll-pixiv
 * Domain Path: /languages
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

define('ZIBLL_PIXIV_VERSION', '0.1.0');
define('ZIBLL_PIXIV_FILE', __FILE__);
define('ZIBLL_PIXIV_DIR', plugin_dir_path(__FILE__));
define('ZIBLL_PIXIV_URL', plugin_dir_url(__FILE__));

/**
 * Keep the loader quiet and defer all business code until WordPress is ready.
 */
function zibll_pixiv_require_classes(): void
{
    $files = array(
        'class-id-parser.php',
        'class-request-policy.php',
        'class-settings.php',
        'class-rewrite.php',
        'class-rest-api.php',
        'class-plugin.php',
    );
    foreach ($files as $file) {
        require_once ZIBLL_PIXIV_DIR . 'includes/' . $file;
    }
}

function zibll_pixiv_load(): void
{
    if (version_compare(PHP_VERSION, '8.0', '<') || version_compare(get_bloginfo('version'), '7.0', '<')) {
        add_action(
            'admin_notices',
            static function (): void {
                if (current_user_can('manage_options')) {
                    echo '<div class="notice notice-error"><p>' . esc_html__('Zibll Pixiv 需要 PHP 8.0+ 与 WordPress 7.0+。', 'zibll-pixiv') . '</p></div>';
                }
            }
        );
        return;
    }

    zibll_pixiv_require_classes();

    add_action(
        'init',
        static function (): void {
            load_plugin_textdomain(
                'zibll-pixiv',
                false,
                dirname(plugin_basename(__FILE__)) . '/languages'
            );
        },
        1
    );
    Zibll_Pixiv_Plugin::instance();
}

function zibll_pixiv_activate(): void
{
    zibll_pixiv_require_classes();
    Zibll_Pixiv_Plugin::activate();
}

function zibll_pixiv_deactivate(): void
{
    zibll_pixiv_require_classes();
    Zibll_Pixiv_Plugin::deactivate();
}

add_action('plugins_loaded', 'zibll_pixiv_load', 20);
register_activation_hook(__FILE__, 'zibll_pixiv_activate');
register_deactivation_hook(__FILE__, 'zibll_pixiv_deactivate');
