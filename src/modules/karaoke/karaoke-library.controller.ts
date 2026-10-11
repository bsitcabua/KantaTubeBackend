import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import {
  parseFavoriteInput,
  parsePagination,
  parsePlaylistInput,
  parsePlaylistItemInput,
  parseReorderInput,
  parseSearch,
  parseUuid,
} from './karaoke-library.dto';
import { KaraokeLibraryService } from './karaoke-library.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class KaraokeLibraryController {
  constructor(private readonly library: KaraokeLibraryService) {}

  @Get('favorites')
  listFavorites(@CurrentUser() user: User, @Query('page') page: unknown, @Query('limit') limit: unknown, @Query('search') search: unknown) {
    const pagination = parsePagination(page, limit);
    return this.library.listFavorites(user.id, pagination.page, pagination.limit, parseSearch(search));
  }

  @Post('favorites')
  @UseGuards(OriginGuard)
  createFavorite(@CurrentUser() user: User, @Body() body: unknown) {
    return this.library.createFavorite(user.id, parseFavoriteInput(body));
  }

  @Delete('favorites/:id')
  @UseGuards(OriginGuard)
  removeFavorite(@CurrentUser() user: User, @Param('id') id: string) {
    return this.library.removeFavorite(user.id, parseUuid(id, 'favorite id'));
  }

  @Get('playlists')
  listPlaylists(@CurrentUser() user: User, @Query('page') page: unknown, @Query('limit') limit: unknown) {
    const pagination = parsePagination(page, limit);
    return this.library.listPlaylists(user.id, pagination.page, pagination.limit);
  }

  @Post('playlists')
  @UseGuards(OriginGuard)
  createPlaylist(@CurrentUser() user: User, @Body() body: unknown) {
    return this.library.createPlaylist(user.id, parsePlaylistInput(body));
  }

  @Get('playlists/:id')
  getPlaylist(@CurrentUser() user: User, @Param('id') id: string) {
    return this.library.getPlaylist(user.id, parseUuid(id, 'playlist id'));
  }

  @Patch('playlists/:id')
  @UseGuards(OriginGuard)
  renamePlaylist(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.library.renamePlaylist(user.id, parseUuid(id, 'playlist id'), parsePlaylistInput(body));
  }

  @Delete('playlists/:id')
  @UseGuards(OriginGuard)
  deletePlaylist(@CurrentUser() user: User, @Param('id') id: string) {
    return this.library.deletePlaylist(user.id, parseUuid(id, 'playlist id'));
  }

  @Post('playlists/:id/items')
  @UseGuards(OriginGuard)
  addPlaylistItem(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.library.addPlaylistItem(user.id, parseUuid(id, 'playlist id'), parsePlaylistItemInput(body));
  }

  @Delete('playlists/:id/items/:itemId')
  @UseGuards(OriginGuard)
  removePlaylistItem(@CurrentUser() user: User, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.library.removePlaylistItem(user.id, parseUuid(id, 'playlist id'), parseUuid(itemId, 'playlist item id'));
  }

  @Patch('playlists/:id/items/reorder')
  @UseGuards(OriginGuard)
  reorderPlaylistItems(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.library.reorderPlaylistItems(user.id, parseUuid(id, 'playlist id'), parseReorderInput(body));
  }
}
