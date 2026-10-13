<?php
/**
 * Uninstall cleanup.
 *
 * @package Zibll_Pixiv
 */

if (! defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('zibll_pixiv_options');
delete_option('zibll_pixiv_version');
delete_option('zibll_pixiv_blocked_log');
