import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OriginGuard } from '../auth/guards/origin.guard';
import { User } from '../users/entities/user.entity';
import {
  parseFavoriteInput,
  parsePagination,
  parsePlaylistInput,
  parsePlaylistItemInput,
  parseReorderInput,
  parseSearch,
  parseUuid,
  parseVisibilityInput,
} from './karaoke-library.dto';
import { KaraokeLibraryService } from './karaoke-library.service';
import { RemoteAuthorizationService } from './remote-authorization.service';
import { KaraokeLibraryAuthGuard } from './guards/karaoke-library-auth.guard';

@Controller()
@UseGuards(KaraokeLibraryAuthGuard)
export class KaraokeLibraryController {
  constructor(
    private readonly library: KaraokeLibraryService,
    private readonly remoteAuthorization: RemoteAuthorizationService,
  ) {}

  @Get('favorites')
  async listFavorites(@CurrentUser() user: User, @Query('page') page: unknown, @Query('limit') limit: unknown, @Query('search') search: unknown, @Query('scope') scope: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    const pagination = parsePagination(page, limit);
    const publicOnly = await this.resolveRemoteScope(user, scope, headers);
    return this.library.listFavorites(user.id, pagination.page, pagination.limit, parseSearch(search), publicOnly);
  }

  @Post('favorites')
  @UseGuards(OriginGuard)
  async createFavorite(@CurrentUser() user: User, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.createFavorite(user.id, parseFavoriteInput(body));
  }

  @Delete('favorites/:id')
  @UseGuards(OriginGuard)
  async removeFavorite(@CurrentUser() user: User, @Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.removeFavorite(user.id, parseUuid(id, 'favorite id'));
  }

  @Patch('favorites/visibility')
  @UseGuards(OriginGuard)
  async setAllFavoriteVisibility(@CurrentUser() user: User, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.setAllFavoriteVisibility(user.id, parseVisibilityInput(body).visibility);
  }

  @Patch('favorites/:id/visibility')
  @UseGuards(OriginGuard)
  async setFavoriteVisibility(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.setFavoriteVisibility(user.id, parseUuid(id, 'favorite id'), parseVisibilityInput(body).visibility);
  }

  @Get('playlists')
  async listPlaylists(@CurrentUser() user: User, @Query('page') page: unknown, @Query('limit') limit: unknown, @Query('scope') scope: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    const pagination = parsePagination(page, limit);
    const publicOnly = await this.resolveRemoteScope(user, scope, headers);
    return this.library.listPlaylists(user.id, pagination.page, pagination.limit, publicOnly);
  }

  @Post('playlists')
  @UseGuards(OriginGuard)
  async createPlaylist(@CurrentUser() user: User, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.createPlaylist(user.id, parsePlaylistInput(body));
  }

  @Get('playlists/:id')
  async getPlaylist(@CurrentUser() user: User, @Param('id') id: string, @Query('scope') scope: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    const publicOnly = await this.resolveRemoteScope(user, scope, headers);
    return this.library.getPlaylist(user.id, parseUuid(id, 'playlist id'), publicOnly);
  }

  @Patch('playlists/visibility')
  @UseGuards(OriginGuard)
  async setAllPlaylistVisibility(@CurrentUser() user: User, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.setAllPlaylistVisibility(user.id, parseVisibilityInput(body).visibility);
  }

  @Patch('playlists/:id')
  @UseGuards(OriginGuard)
  async renamePlaylist(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.renamePlaylist(user.id, parseUuid(id, 'playlist id'), parsePlaylistInput(body));
  }

  @Patch('playlists/:id/visibility')
  @UseGuards(OriginGuard)
  async setPlaylistVisibility(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.setPlaylistVisibility(user.id, parseUuid(id, 'playlist id'), parseVisibilityInput(body).visibility);
  }

  @Delete('playlists/:id')
  @UseGuards(OriginGuard)
  async deletePlaylist(@CurrentUser() user: User, @Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.deletePlaylist(user.id, parseUuid(id, 'playlist id'));
  }

  @Post('playlists/:id/items')
  @UseGuards(OriginGuard)
  async addPlaylistItem(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.addPlaylistItem(user.id, parseUuid(id, 'playlist id'), parsePlaylistItemInput(body));
  }

  @Delete('playlists/:id/items/:itemId')
  @UseGuards(OriginGuard)
  async removePlaylistItem(@CurrentUser() user: User, @Param('id') id: string, @Param('itemId') itemId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.removePlaylistItem(user.id, parseUuid(id, 'playlist id'), parseUuid(itemId, 'playlist item id'));
  }

  @Patch('playlists/:id/items/reorder')
  @UseGuards(OriginGuard)
  async reorderPlaylistItems(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    await this.assertOwnerMutation(user, headers);
    return this.library.reorderPlaylistItems(user.id, parseUuid(id, 'playlist id'), parseReorderInput(body));
  }

  private async resolveRemoteScope(
    user: User,
    scope: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean> {
    const remoteSessionId = this.headerValue(headers['x-kantatube-remote-session']);
    const remoteDeviceId = this.headerValue(headers['x-kantatube-remote-device']);
    const remoteGrantToken = this.headerValue(headers['x-kantatube-remote-grant']);
    if (remoteSessionId || remoteDeviceId || remoteGrantToken) {
      if (!remoteSessionId || !remoteDeviceId || !remoteGrantToken) {
        // Fail closed if a request claims to be from a Remote but omits part
        // of its capability proof.
        await this.remoteAuthorization.authorizeLibraryAccess(user.id, remoteSessionId || '', remoteDeviceId || '', remoteGrantToken);
      } else {
        await this.remoteAuthorization.authorizeLibraryAccess(user.id, remoteSessionId, remoteDeviceId, remoteGrantToken);
      }
      return true;
    }
    return scope === 'public';
  }

  private headerValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }

  private async assertOwnerMutation(
    user: User,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const remoteSessionId = this.headerValue(headers['x-kantatube-remote-session']);
    const remoteDeviceId = this.headerValue(headers['x-kantatube-remote-device']);
    const remoteGrantToken = this.headerValue(headers['x-kantatube-remote-grant']);
    if (!remoteSessionId && !remoteDeviceId && !remoteGrantToken) return;
    await this.remoteAuthorization.authorizeLibraryAccess(
      user.id,
      remoteSessionId,
      remoteDeviceId,
      remoteGrantToken,
    );
    throw new ForbiddenException('Account library changes must be made from the Main screen.');
  }
}
